/**
 * One-shot backfill of Wandering Soul H3's (wsh3) past SOEX campouts from Hash Rego (#2632).
 *
 * The HASHREGO adapter reads the global /events index, which lists only upcoming events, and
 * `/api/kennels/SoulH3/events/` returns [] — so the 2023–2025 editions survive only as
 * standalone event pages. Each page is parsed with the live adapter's `parseEventDetail` +
 * `splitToRawEvents`; the index-row fields the adapter would normally get from /events
 * (start date, start time, cost, type) are supplied here from the page text, verified live
 * 2026-11-05. Stored as one row per campout (the Friday start), matching SOEX 2026.
 *
 *   Dry run:  BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/backfill-wsh3-soex-history.ts
 *   Apply:    BACKFILL_APPLY=1 BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/backfill-wsh3-soex-history.ts
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import { eventDetailUrl } from "@/adapters/hashrego/api";
import { parseEventDetail, splitToRawEvents, type IndexEntry } from "@/adapters/hashrego/parser";
import { USER_AGENT } from "@/adapters/hashrego/constants";
import type { RawEventData } from "@/adapters/types";

/** startDate "MM/DD/YY" / startTime "HH:MM AM" as the /events index formats them. */
const EDITIONS: Omit<IndexEntry, "kennelSlug" | "type">[] = [
  { slug: "wsh3-southern-exposure-2023-2023", title: "WSH3 Southern Exposure 2023", startDate: "06/09/23", startTime: "04:00 PM", cost: "$100" },
  { slug: "wsh3-southern-exposure-2024-2024", title: "WSH3 Southern Exposure 2024", startDate: "06/21/24", startTime: "03:00 PM", cost: "$105" },
  { slug: "wsh3-soex-2025", title: "WSH3 SOEX 2025", startDate: "06/20/25", startTime: "", cost: "$110" },
];

runBackfillScript({
  sourceName: "Hash Rego",
  kennelTimezone: "America/Chicago",
  label: "Fetching + parsing 3 past WSH3 SOEX Hash Rego pages",
  fetchEvents: async () => {
    const out: RawEventData[] = [];
    for (const ed of EDITIONS) {
      const res = await fetch(eventDetailUrl(ed.slug), {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`Hash Rego ${ed.slug}: HTTP ${res.status}`);
      const entry: IndexEntry = { ...ed, kennelSlug: "SoulH3", type: "Hash Campout" };
      const parsed = parseEventDetail(await res.text(), ed.slug, entry);
      const raws = splitToRawEvents(parsed, ed.slug).map((r) => ({ ...r, kennelTags: ["wsh3"], title: ed.title }));
      if (raws.length === 0) throw new Error(`Parsed 0 rows from ${ed.slug}`);
      out.push(...raws);
    }
    return out;
  },
}).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
