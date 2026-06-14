/**
 * One-shot historical backfill for BTH3 (Bangkok Thursday H3). Issue #987.
 *
 * The live BTH3 adapter scrapes the Hareline sidebar widget on the
 * homepage (currently captures 1 past event). The kennel's public Run
 * Archives expose 222 detail pages (Run #298 → #520) at:
 *   /thursday/index.php/run-archives-bth3/{joomla-id}-run-{NNN}
 *
 * Reuses `parseNextRunArticle` from the BTH3 adapter — its own comment
 * documents that it handles both the homepage `.item-content` and the
 * archive `.com-content-article__body` template, so no parser fork.
 *
 * Usage:
 *   Dry run:  npx tsx scripts/backfill-bth3-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-bth3-history.ts
 */

import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import { walkJoomlaArchive } from "./lib/joomla-archive-backfill";
import { parseNextRunArticle } from "@/adapters/html-scraper/bangkokhash";

const SOURCE_NAME = "Bangkok Thursday Hash";
const KENNEL_TIMEZONE = "Asia/Bangkok";
const KENNEL_TAG = "bth3";
const DEFAULT_TIME = "18:30";

const BASE_URL = "https://www.bangkokhash.com";
const INDEX_URL = `${BASE_URL}/thursday/index.php/run-archives-bth3?limit=0`;
const DETAIL_URL_RE = /\/thursday\/index\.php\/run-archives-bth3\/\d+-run-\d+/g;

runBackfillScript({
  sourceName: SOURCE_NAME,
  kennelTimezone: KENNEL_TIMEZONE,
  label: "Walking BTH3 archive",
  fetchEvents: () =>
    walkJoomlaArchive({
      baseUrl: BASE_URL,
      indexUrl: INDEX_URL,
      detailUrlRe: DETAIL_URL_RE,
      parse: (html, url) => parseNextRunArticle(html, KENNEL_TAG, DEFAULT_TIME, url),
    }),
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
