/**
 * Regenerate `scripts/data/brasilia-h3-history.json` from the live Blogger
 * archive using the adapter's exported `parseBrasiliaPost`. Run once after a
 * parser change (e.g. #1981/#1982/#1983 added title + hares + prose location);
 * commit the regenerated JSON. The recurring loader stays dumb (no parser).
 *
 * Archive = PAST events only (date < today in kennel tz) — the live adapter
 * covers the current/future window, so the committed archive never drifts with
 * upcoming runs. No DB writes; this only rewrites the JSON file.
 *
 * Usage: npx tsx scripts/generate-brasilia-h3-history.ts
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { fetchBloggerPosts } from "@/adapters/blogger-api";
import { parseBrasiliaPost } from "@/adapters/html-scraper/brasilia-h3";
import { stripHtmlTags } from "@/adapters/utils";
import { todayInTimezone } from "@/lib/timezone";
import type { RawEventData } from "@/adapters/types";

const BLOG_URL = "https://brasiliah3.blogspot.com/";
const KENNEL_TIMEZONE = "America/Sao_Paulo";
const OUT = "scripts/data/brasilia-h3-history.json";

async function main(): Promise<void> {
  const res = await fetchBloggerPosts(BLOG_URL, 500);
  if (res.error) throw new Error(`Blogger fetch failed: ${res.error.message}`);
  const today = todayInTimezone(KENNEL_TIMEZONE);

  const rows: RawEventData[] = [];
  for (const post of res.posts) {
    const body = stripHtmlTags(post.content, "\n");
    const parsed = parseBrasiliaPost(body, post.published, post.url, post.title);
    if (!parsed || parsed.date >= today) continue;
    rows.push({
      date: parsed.date,
      kennelTags: ["brasilia-h3"],
      runNumber: parsed.runNumber,
      title: parsed.title,
      hares: parsed.hares,
      location: parsed.location,
      sourceUrl: parsed.sourceUrl,
    });
  }

  rows.sort((a, b) => a.date.localeCompare(b.date) || (a.runNumber ?? 0) - (b.runNumber ?? 0));
  writeFileSync(OUT, `${JSON.stringify(rows, null, 2)}\n`);

  const runs = rows.map((r) => r.runNumber ?? 0);
  const withTitle = rows.filter((r) => r.title).length;
  const withHares = rows.filter((r) => r.hares).length;
  const withLoc = rows.filter((r) => r.location).length;
  console.log(`Posts fetched: ${res.posts.length}`);
  console.log(`Wrote ${rows.length} past rows to ${OUT}`);
  console.log(`  range: ${rows[0]?.date} (#${runs[0]}) → ${rows.at(-1)?.date} (#${runs.at(-1)})`);
  console.log(`  title=${withTitle}/${rows.length}  hares=${withHares}/${rows.length}  location=${withLoc}/${rows.length}`);
  // Report run-number gaps so #1985 (missing #339 etc.) is visible at a glance.
  const present = new Set(runs);
  const gaps: number[] = [];
  for (let n = Math.min(...runs); n <= Math.max(...runs); n++) if (!present.has(n)) gaps.push(n);
  console.log(`  run-number gaps (${gaps.length}): ${gaps.join(", ") || "none"}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
