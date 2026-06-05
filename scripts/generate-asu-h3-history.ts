/**
 * Regenerate `scripts/data/asu-h3-history.json` from the live WordPress.com REST
 * feed using the adapter's exported `postToEvent`. Run once after a parser
 * change (e.g. #1960/#1961 added the source title + shared-helper hares); commit
 * the regenerated JSON. The recurring loader stays dumb (no parser).
 *
 * Archive = PAST events only (date < today in kennel tz) — the live adapter is
 * future-only, so the committed archive holds the historical runs.
 * No DB writes; this only rewrites the JSON file.
 *
 * Usage: npx tsx scripts/generate-asu-h3-history.ts
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { postToEvent, fetchAllRunPosts } from "@/adapters/html-scraper/asuncion-h3";
import { todayInTimezone } from "@/lib/timezone";
import type { RawEventData } from "@/adapters/types";

const KENNEL_TIMEZONE = "America/Asuncion";
const OUT = "scripts/data/asu-h3-history.json";

async function main(): Promise<void> {
  const posts = await fetchAllRunPosts();
  const today = todayInTimezone(KENNEL_TIMEZONE);

  const rows: RawEventData[] = [];
  for (const post of posts) {
    const ev = postToEvent(post);
    if (!ev || ev.date >= today) continue;
    rows.push(ev);
  }

  // Never overwrite the committed archive with an empty set (a fetch that
  // returned but yielded nothing parseable). fetchAllRunPosts already throws on
  // HTTP/site errors; this guards the parse-yield path.
  if (rows.length === 0) {
    throw new Error("Parsed 0 past rows — refusing to overwrite the committed archive");
  }

  rows.sort((a, b) => a.date.localeCompare(b.date) || (a.runNumber ?? 0) - (b.runNumber ?? 0));
  writeFileSync(OUT, `${JSON.stringify(rows, null, 2)}\n`);

  const withTitle = rows.filter((r) => r.title).length;
  const withHares = rows.filter((r) => r.hares).length;
  console.log(`Posts fetched: ${posts.length}`);
  console.log(`Wrote ${rows.length} past rows to ${OUT}`);
  console.log(`  range: ${rows[0]?.date} (#${rows[0]?.runNumber}) → ${rows.at(-1)?.date} (#${rows.at(-1)?.runNumber})`);
  console.log(`  title=${withTitle}/${rows.length}  hares=${withHares}/${rows.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
