/**
 * Live-verification one-shot for issue #890.
 *
 * Fetches BurlyH3's hareline via the production browser-render path and
 * prints the parsed `trailLengthText` / min / max / difficulty for the
 * first events. Writes a compact summary to stdout for paste-into-PR.
 *
 *   npx tsx scripts/verify-burly-trail.ts
 *
 * Requires BROWSER_RENDER_URL + BROWSER_RENDER_KEY in env (loaded from .env).
 */
import "dotenv/config";
import { BurlingtonHashAdapter } from "@/adapters/html-scraper/burlington-hash";
import type { Source } from "@/generated/prisma/client";

function makeSource(): Source {
  return {
    id: "verify-burly",
    name: "Burlington H3 Website Hareline (verify)",
    url: "https://www.burlingtonh3.com/hareline",
    type: "HTML_SCRAPER",
    trustLevel: 6,
    scrapeFreq: "weekly",
    scrapeDays: 365,
    config: null,
    isActive: true,
    lastScrapeAt: null,
    lastScrapeStatus: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastStructureHash: null,
  } as unknown as Source;
}

async function main() {
  const adapter = new BurlingtonHashAdapter();
  const result = await adapter.fetch(makeSource());

  console.log(`fetched ${result.events.length} events from burlingtonh3.com/hareline`);
  console.log(`errors: ${result.errors.length}`);
  if (result.errors.length > 0) {
    console.log("error detail:", result.errors[0]);
  }
  console.log("");
  console.log("─── trail length + Shiggy Level extraction ───");

  const populated = result.events.filter(
    (e) => e.trailLengthText !== undefined || e.difficulty !== undefined,
  );
  const fixed = populated.filter(
    (e) =>
      e.trailLengthMinMiles !== undefined &&
      e.trailLengthMaxMiles !== undefined &&
      e.trailLengthMinMiles === e.trailLengthMaxMiles,
  );
  const ranged = populated.filter(
    (e) =>
      e.trailLengthMinMiles !== undefined &&
      e.trailLengthMaxMiles !== undefined &&
      e.trailLengthMinMiles !== e.trailLengthMaxMiles,
  );

  console.log(`populated total : ${populated.length}`);
  console.log(`fixed-length    : ${fixed.length}`);
  console.log(`ranged-length   : ${ranged.length}`);
  console.log("");

  for (const e of result.events.slice(0, 12)) {
    const summary = [
      e.date,
      `#${e.runNumber ?? "?"}`,
      `text=${JSON.stringify(e.trailLengthText)}`,
      `min=${e.trailLengthMinMiles}`,
      `max=${e.trailLengthMaxMiles}`,
      `shiggy=${e.difficulty}`,
      e.title ? `· ${e.title.slice(0, 40)}` : "",
    ];
    console.log(summary.join("  "));
  }
}

main().catch((err) => {
  console.error("verify failed:", err);
  process.exit(1);
});
