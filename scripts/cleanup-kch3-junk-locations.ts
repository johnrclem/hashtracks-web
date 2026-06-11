/**
 * One-shot re-clean for KCH3 + PNH3 event locationName junk (#2110 follow-up).
 *
 * The old `parseKCH3Body` Location/Start/Where regex was unanchored and let
 * `\s*` span newlines, so it leaked theme/cost/time text into locationName
 * (e.g. "Hash Cash: $5", "Time 3 p.m.", "@ Private Home:", "of the winter
 * Olympics!!! Come dressed..."). The parser is fixed; this script re-derives
 * each event's location from the live source with the FIXED parser and:
 *   - overwrites the stored value when the re-parse yields a real venue (the
 *     old value was a mis-captured fragment), or
 *   - nulls it when the re-parse yields nothing AND the stored value matches a
 *     junk pattern (cost/time/theme/placeholder/leading-dash). A stored value
 *     that still looks like a real address is left untouched and reported, so
 *     no good (or manually corrected) data is clobbered.
 *
 * Events with no matching source post are left untouched.
 *
 * Dry run:  npx tsx scripts/cleanup-kch3-junk-locations.ts
 * Apply:    CLEANUP_APPLY=1 npx tsx scripts/cleanup-kch3-junk-locations.ts
 * Env:      DATABASE_URL
 */
import "dotenv/config";
import { prisma } from "@/lib/db";
import { fetchAllWordPressPosts, type WordPressPost } from "@/adapters/wordpress-api";
import { processKCH3Post } from "@/adapters/html-scraper/kch3";
import { htmlToNewlineText } from "@/adapters/utils";

const BASE_URL = "https://kansascityh3.com/";
const KENNEL_CODES = ["kch3", "pnh3"];

// Patterns that mark a stored locationName as non-venue junk (gate for action).
// Deliberately NOT a bare leading-dash: real venues are sometimes stored as
// "– Wyandotte County Lake Park…" / "- Kelly's Westport Inn"; only the time/
// cost/theme/placeholder fragments below are junk.
const JUNK_PATTERNS: RegExp[] = [
  /^(?:hash\s*cash|cost|time|meet\s*up|pack\s*(?:away|up|out))\b/i, // cost/time/meetup labels
  /^@\s/, // "@ Private Home:"
  /^\d{1,2}(?::\d{2})?\s?(?:a\.?m\.?|p\.?m\.?)\.?$/i, // bare time ("3 p.m.", "2:00pm")
  /!!|come dressed|bring your|going for gold/i, // theme prose
  /\bapproximately\b/i, // "… – approximately 5pm."
];

function isJunkLocation(value: string): boolean {
  return JUNK_PATTERNS.some((re) => re.test(value.trim()));
}

export interface EventRow {
  id: string;
  date: Date;
  kennelId: string;
  locationName: string | null;
}
interface Change {
  id: string;
  date: string;
  old: string;
  fresh: string | null;
}

/** Re-derive each post's location with the fixed parser, keyed by `${kennelCode}|${date}`. */
function buildFreshLocationMap(posts: WordPressPost[]): Map<string, string | null> {
  const freshByKey = new Map<string, string | null>();
  for (const post of posts) {
    const ev = processKCH3Post(post.title, htmlToNewlineText(post.content), post.url, post.date);
    if (!ev) continue;
    const key = `${ev.kennelTags[0]}|${ev.date}`;
    const loc = ev.location ?? null;
    // Prefer a defined location if two posts collide on the same key.
    if (!freshByKey.has(key) || (loc && !freshByKey.get(key))) freshByKey.set(key, loc);
  }
  return freshByKey;
}

/**
 * Only ACT on stored values that match a junk pattern — a good (or cosmetically
 * different) venue is left untouched, so we never churn or regress real data.
 * For a junk value: overwrite with the re-parsed venue when one is recovered,
 * else null it.
 */
export function classifyJunkEvents(
  events: EventRow[],
  codeById: Map<string, string>,
  freshByKey: Map<string, string | null>,
): { overwrite: Change[]; nulled: Change[] } {
  const overwrite: Change[] = [];
  const nulled: Change[] = [];
  for (const e of events) {
    const old = e.locationName;
    if (old == null || !isJunkLocation(old)) continue;
    const dateStr = e.date.toISOString().slice(0, 10);
    const key = `${codeById.get(e.kennelId)}|${dateStr}`;
    // No matching source post → leave untouched. Must check `.has()` before
    // `.get() ?? null`, else an unfetched post (key absent → undefined → null)
    // is indistinguishable from a fetched post with no location, and the junk
    // row would be wrongly nulled (gemini, PR #2136).
    if (!freshByKey.has(key)) continue;
    const fresh = freshByKey.get(key) ?? null;
    if (fresh === old) continue; // fresh is never junk, but guard anyway
    (fresh ? overwrite : nulled).push({ id: e.id, date: dateStr, old, fresh });
  }
  return { overwrite, nulled };
}

function logSample(rows: Change[], withFresh: boolean): void {
  for (const r of rows.slice(0, 30)) {
    const extra = withFresh && r.fresh ? ` → ${JSON.stringify(r.fresh.slice(0, 60))}` : "";
    console.log(`  ${r.date} ${JSON.stringify(r.old.slice(0, 70))}${extra}`);
  }
  if (rows.length > 30) console.log(`  …and ${rows.length - 30} more`);
}

async function main() {
  const apply = process.env.CLEANUP_APPLY === "1";
  console.log(`Mode: ${apply ? "APPLY (will write to DB)" : "DRY RUN (no writes)"}\n`);

  // 1. Re-derive location from the live source with the fixed parser. Abort on
  //    an empty fetch: treating a failed/empty pull as "no source venues" would
  //    null every junk row. fetchAllWordPressPosts throws on a real error; an
  //    empty array means the archive vanished, so stop.
  const posts = await fetchAllWordPressPosts(BASE_URL, { perPage: 100, maxPages: 50 });
  if (posts.length === 0) {
    throw new Error("KCH3 WordPress archive returned 0 posts — aborting to avoid nulling on a bad fetch.");
  }
  const freshByKey = buildFreshLocationMap(posts);
  console.log(`Re-derived ${freshByKey.size} (kennel|date) locations from ${posts.length} posts.\n`);

  // 2. Load every stored KCH3/PNH3 event location.
  const kennels = await prisma.kennel.findMany({
    where: { kennelCode: { in: KENNEL_CODES } },
    select: { id: true, kennelCode: true },
  });
  const codeById = new Map(kennels.map((k) => [k.id, k.kennelCode]));
  const events = await prisma.event.findMany({
    where: { kennelId: { in: kennels.map((k) => k.id) }, locationName: { not: null } },
    select: { id: true, date: true, kennelId: true, locationName: true },
  });

  // 3. Classify + report.
  const { overwrite, nulled } = classifyJunkEvents(events, codeById, freshByKey);
  console.log(`OVERWRITE junk → re-parsed venue: ${overwrite.length}`);
  logSample(overwrite, true);
  console.log(`\nNULL (junk, no venue recoverable from source): ${nulled.length}`);
  logSample(nulled, false);

  if (!apply) {
    console.log("\nDry run complete. Re-run with CLEANUP_APPLY=1 to write.");
    await prisma.$disconnect();
    return;
  }

  for (const r of [...overwrite, ...nulled]) {
    await prisma.event.update({ where: { id: r.id }, data: { locationName: r.fresh } });
  }
  console.log(`\nApplied: ${overwrite.length + nulled.length} events updated (${overwrite.length} overwritten, ${nulled.length} nulled).`);
  await prisma.$disconnect();
}

// Guard the entrypoint so importing this module (e.g. from the unit test for
// classifyJunkEvents) doesn't fire main() and hit the live DB.
if (process.argv[1]?.endsWith("cleanup-kch3-junk-locations.ts")) {
  main().catch((e) => {
    console.error("FAILED:", e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
