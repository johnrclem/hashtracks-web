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
import { fetchAllWordPressPosts } from "@/adapters/wordpress-api";
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

async function main() {
  const apply = process.env.CLEANUP_APPLY === "1";
  console.log(`Mode: ${apply ? "APPLY (will write to DB)" : "DRY RUN (no writes)"}\n`);

  // 1. Re-derive location from the live source with the fixed parser.
  const posts = await fetchAllWordPressPosts(BASE_URL, { perPage: 100, maxPages: 50 });
  // Abort on an empty fetch: treating a failed/empty pull as "no source venues"
  // would null every junk row (and overwrite none). fetchAllWordPressPosts
  // throws on a real error; an empty array means the archive vanished, so stop.
  if (posts.length === 0) {
    throw new Error("KCH3 WordPress archive returned 0 posts — aborting to avoid nulling on a bad fetch.");
  }
  const freshByKey = new Map<string, string | null>(); // `${kennelCode}|${YYYY-MM-DD}` → location
  for (const post of posts) {
    const ev = processKCH3Post(post.title, htmlToNewlineText(post.content), post.url, post.date);
    if (!ev) continue;
    const key = `${ev.kennelTags[0]}|${ev.date}`;
    const loc = ev.location ?? null;
    // Prefer a defined location if two posts collide on the same key.
    if (!freshByKey.has(key) || (loc && !freshByKey.get(key))) freshByKey.set(key, loc);
  }
  console.log(`Re-derived ${freshByKey.size} (kennel|date) locations from ${posts.length} posts.\n`);

  // 2. Load every stored KCH3/PNH3 event location.
  const kennels = await prisma.kennel.findMany({
    where: { kennelCode: { in: KENNEL_CODES } },
    select: { id: true, kennelCode: true },
  });
  const codeById = new Map(kennels.map((k) => [k.id, k.kennelCode]));
  const events = await prisma.event.findMany({
    where: { kennelId: { in: kennels.map((k) => k.id) }, locationName: { not: null } },
    select: { id: true, date: true, kennelId: true, title: true, locationName: true },
  });

  // 3. Diff stored vs fresh — but only ACT on stored values that match a junk
  //    pattern. A good (or cosmetically-different) venue is left untouched, so
  //    we never churn or regress real data; we only fix the leaked theme/cost/
  //    time/placeholder strings. For a junk value we overwrite with the
  //    re-parsed venue when the fixed parser recovers one, else null it.
  const overwrite: { id: string; date: string; old: string; fresh: string }[] = [];
  const nulled: { id: string; date: string; old: string }[] = [];

  for (const e of events) {
    const old = e.locationName;
    if (old == null || !isJunkLocation(old)) continue; // only touch junk
    const code = codeById.get(e.kennelId);
    const dateStr = e.date.toISOString().slice(0, 10);
    const fresh = freshByKey.get(`${code}|${dateStr}`) ?? null;
    if (fresh === old) continue; // shouldn't happen (fresh is never junk), but safe

    if (fresh) overwrite.push({ id: e.id, date: dateStr, old, fresh });
    else nulled.push({ id: e.id, date: dateStr, old });
  }

  const sample = <T extends { date: string; old: string }>(rows: T[], extra?: (r: T) => string) => {
    for (const r of rows.slice(0, 30)) {
      console.log(`  ${r.date} ${JSON.stringify(r.old.slice(0, 70))}${extra ? extra(r) : ""}`);
    }
    if (rows.length > 30) console.log(`  …and ${rows.length - 30} more`);
  };

  console.log(`OVERWRITE junk → re-parsed venue: ${overwrite.length}`);
  sample(overwrite, (r) => ` → ${JSON.stringify(r.fresh.slice(0, 60))}`);
  console.log(`\nNULL (junk, no venue recoverable from source): ${nulled.length}`);
  sample(nulled);

  if (!apply) {
    console.log("\nDry run complete. Re-run with CLEANUP_APPLY=1 to write.");
    await prisma.$disconnect();
    return;
  }

  let updated = 0;
  for (const r of overwrite) {
    await prisma.event.update({ where: { id: r.id }, data: { locationName: r.fresh } });
    updated++;
  }
  for (const r of nulled) {
    await prisma.event.update({ where: { id: r.id }, data: { locationName: null } });
    updated++;
  }
  console.log(`\nApplied: ${updated} events updated (${overwrite.length} overwritten, ${nulled.length} nulled).`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
