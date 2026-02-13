/**
 * One-off script to scrape hashnyc.com for hare names and produce a roster seed file.
 * Reuses the existing HashNYCAdapter parsing logic (Cheerio-based HTML scraping).
 *
 * Usage:
 *   Live fetch:    npx tsx scripts/scrape-hashnyc-hares.ts
 *   From files:    npx tsx scripts/scrape-hashnyc-hares.ts --file past.html [future.html]
 *
 * For file mode, save these pages from your browser:
 *   Past events:   https://hashnyc.com/?days=365&backwards=true
 *   Future events: https://hashnyc.com/?days=365
 *
 * Output: data/hashnyc-hare-roster.json
 */

import * as cheerio from "cheerio";
import {
  extractHares,
  extractYear,
  extractMonthDay,
  extractTime,
  parseDetailsCell,
  decodeHtmlEntities,
} from "../src/adapters/html-scraper/hashnyc";
import type { RawEventData } from "../src/adapters/types";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";

// ── Config ──────────────────────────────────────────────────────────────────

const LOOKBACK_DAYS = 365;
const BASE_URL = "https://hashnyc.com";
const OUTPUT_PATH = resolve(__dirname, "../data/hashnyc-hare-roster.json");

/** Similarity threshold for flagging potential duplicates (0–1) */
const FUZZY_THRESHOLD = 0.7;

/** Placeholder strings to ignore */
const IGNORE_PATTERNS = [
  /^n\/?a$/i,
  /^tbd$/i,
  /^tba$/i,
  /sign up/i,
  /^-+$/,
  /^\?+$/,
  /^unknown$/i,
  /^none$/i,
];

// ── Levenshtein (inlined from src/lib/fuzzy.ts to avoid import issues) ──────

function levenshtein(a: string, b: string): number {
  const la = a.length;
  const lb = b.length;
  const dp: number[][] = Array.from({ length: la + 1 }, () =>
    Array(lb + 1).fill(0),
  );
  for (let i = 0; i <= la; i++) dp[i][0] = i;
  for (let j = 0; j <= lb; j++) dp[0][j] = j;
  for (let i = 1; i <= la; i++) {
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[la][lb];
}

function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

// ── HTML Parsing (mirrors HashNYCAdapter.parseRows without needing the class) ──

function parseRowsFromHtml(
  html: string,
  tableSelector: string,
  isFuture: boolean,
): { events: RawEventData[]; errors: string[] } {
  const $ = cheerio.load(html);
  const rows = $(tableSelector + " tr");
  const events: RawEventData[] = [];
  const errors: string[] = [];
  const currentYear = new Date().getFullYear();

  rows.each((_i, row) => {
    try {
      const cells = $(row).find("td");
      if (cells.length < 2) return;

      const dateCellHtml = cells.eq(0).html() ?? "";
      const dateCellText = decodeHtmlEntities(dateCellHtml);
      const startTime = extractTime(dateCellText);

      let year: number | null;

      if (isFuture) {
        year = currentYear;
      } else {
        const rowId = $(row).attr("id") ?? undefined;
        year = extractYear(rowId, dateCellHtml);
      }

      if (!year || year < 2016) return;

      const monthDay = extractMonthDay(dateCellText);
      if (!monthDay) return;

      if (isFuture && monthDay.month < new Date().getMonth()) {
        year = currentYear + 1;
      }

      const eventDate = new Date(
        Date.UTC(year, monthDay.month, monthDay.day, 12, 0, 0),
      );
      const dateStr = eventDate.toISOString().split("T")[0];

      const detailsCell = cells.eq(1);
      const parsed = parseDetailsCell($, detailsCell);

      let hares: string;
      if (isFuture && cells.length >= 3) {
        hares = decodeHtmlEntities(cells.eq(2).html() ?? "").trim();
      } else {
        hares = extractHares($, row);
      }

      if (hares && /sign up to hare/i.test(hares)) {
        hares = "N/A";
      }

      events.push({
        date: dateStr,
        kennelTag: parsed.kennelTag,
        runNumber: parsed.runNumber,
        title: parsed.title,
        description: parsed.description,
        hares: hares && hares !== "N/A" ? hares : undefined,
        location: parsed.location,
        locationUrl: parsed.locationUrl,
        startTime,
      });
    } catch (err) {
      errors.push(
        `Row parse error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });

  return { events, errors };
}

// ── Fetch Modes ─────────────────────────────────────────────────────────────

async function fetchLive(): Promise<{ events: RawEventData[]; errors: string[] }> {
  console.log(`Fetching hashnyc.com (${LOOKBACK_DAYS} days backward + upcoming)...`);

  // Dynamic import to avoid pulling in the adapter's generateStructureHash
  // dependency chain when using file mode
  const { HashNYCAdapter } = await import("../src/adapters/html-scraper/hashnyc");
  const adapter = new HashNYCAdapter();

  // Minimal Source mock — adapter only uses source.url
  const mockSource = { url: BASE_URL } as any;
  return adapter.fetch(mockSource, { days: LOOKBACK_DAYS });
}

function fetchFromFiles(pastFile: string, futureFile?: string): { events: RawEventData[]; errors: string[] } {
  const allEvents: RawEventData[] = [];
  const allErrors: string[] = [];

  // Parse past events
  const pastPath = resolve(pastFile);
  if (!existsSync(pastPath)) {
    throw new Error(`Past events file not found: ${pastPath}`);
  }
  console.log(`Parsing past events from: ${pastPath}`);
  const pastHtml = readFileSync(pastPath, "utf-8");
  const past = parseRowsFromHtml(pastHtml, "table.past_hashes", false);
  allEvents.push(...past.events);
  allErrors.push(...past.errors);
  console.log(`  Found ${past.events.length} past events`);

  // Parse future events (optional)
  if (futureFile) {
    const futurePath = resolve(futureFile);
    if (!existsSync(futurePath)) {
      throw new Error(`Future events file not found: ${futurePath}`);
    }
    console.log(`Parsing future events from: ${futurePath}`);
    const futureHtml = readFileSync(futurePath, "utf-8");
    const future = parseRowsFromHtml(futureHtml, "table.future_hashes", true);
    allEvents.push(...future.events);
    allErrors.push(...future.errors);
    console.log(`  Found ${future.events.length} future events`);
  }

  return { events: allEvents, errors: allErrors };
}

// ── Name Splitting ──────────────────────────────────────────────────────────

function splitHareNames(haresText: string): string[] {
  // Split on comma first
  const parts = haresText.split(",");
  const names: string[] = [];

  for (const part of parts) {
    // Then split on " & " and " and "
    const subParts = part
      .split(/\s+&\s+/i)
      .flatMap((s) => s.split(/\s+and\s+/i));

    for (const name of subParts) {
      const trimmed = name.replace(/\s+/g, " ").trim();
      if (!trimmed) continue;
      if (IGNORE_PATTERNS.some((p) => p.test(trimmed))) continue;
      names.push(trimmed);
    }
  }

  return names;
}

// ── Dedup Logic ─────────────────────────────────────────────────────────────

interface HareEntry {
  name: string;
  timesSeen: number;
  variants: string[];
}

interface KennelRoster {
  count: number;
  hares: { name: string; timesSeen: number; variants?: string[] }[];
}

interface DuplicateCandidate {
  names: [string, string];
  kennels: string[];
  similarity: number;
  counts: [number, number];
  matchType?: string;
}

function buildRoster(
  namesByKennel: Map<string, string[]>,
): Map<string, HareEntry[]> {
  const result = new Map<string, HareEntry[]>();

  for (const [kennel, names] of namesByKennel) {
    const grouped = new Map<string, Map<string, number>>();
    for (const name of names) {
      const key = name.toLowerCase();
      if (!grouped.has(key)) grouped.set(key, new Map());
      const variants = grouped.get(key)!;
      variants.set(name, (variants.get(name) ?? 0) + 1);
    }

    const entries: HareEntry[] = [];
    for (const [, variants] of grouped) {
      let bestName = "";
      let bestCount = 0;
      let totalCount = 0;
      const allVariants: string[] = [];

      for (const [name, count] of variants) {
        allVariants.push(name);
        totalCount += count;
        if (count > bestCount) {
          bestCount = count;
          bestName = name;
        }
      }

      entries.push({
        name: bestName,
        timesSeen: totalCount,
        variants: allVariants.length > 1 ? allVariants : [],
      });
    }

    entries.sort((a, b) => b.timesSeen - a.timesSeen || a.name.localeCompare(b.name));
    result.set(kennel, entries);
  }

  return result;
}

/** Stop words for token comparison (English + common hash name prefixes) */
const STOP_WORDS = new Set([
  "a", "an", "the", "of", "in", "on", "at", "to", "for", "is", "it", "my", "no",
  "just",  // "Just [Name]" is a common hash naming pattern for unnamed hashers
  "half",  // "Half Mind" etc.
]);

/** Tokenize a name into distinctive words (lowercase, no stop words, min 2 chars) */
function tokenize(name: string): string[] {
  return name.toLowerCase().split(/\s+/).filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
}

/**
 * Token overlap score using overlap coefficient (shared / min(|A|,|B|)).
 * This is less punishing than Jaccard when names have different word counts.
 * "Pizza Slut" vs "Piece of Slut" → shared "slut" / min(2,2) = 0.5
 */
function tokenOverlap(a: string, b: string): number {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  let sharedCount = 0;
  for (const t of tokensA) {
    if (tokensB.includes(t)) sharedCount++;
  }
  if (sharedCount === 0) return 0;

  return sharedCount / Math.min(tokensA.length, tokensB.length);
}

function findDuplicates(
  rosterByKennel: Map<string, HareEntry[]>,
): DuplicateCandidate[] {
  const duplicates: DuplicateCandidate[] = [];
  const seen = new Set<string>();

  const allNames = new Map<string, { kennels: Set<string>; totalCount: number }>();
  for (const [kennel, entries] of rosterByKennel) {
    for (const entry of entries) {
      const key = entry.name.toLowerCase();
      if (!allNames.has(key)) {
        allNames.set(key, { kennels: new Set(), totalCount: 0 });
      }
      const record = allNames.get(key)!;
      record.kennels.add(kennel);
      record.totalCount += entry.timesSeen;
    }
  }

  const nameList = Array.from(allNames.entries());
  for (let i = 0; i < nameList.length; i++) {
    for (let j = i + 1; j < nameList.length; j++) {
      const [keyA, dataA] = nameList[i];
      const [keyB, dataB] = nameList[j];

      if (keyA === keyB) continue;

      // Two-pronged matching: Levenshtein OR token overlap (different thresholds)
      const levSim = similarity(keyA, keyB);
      const tokSim = tokenOverlap(keyA, keyB);

      const isLevMatch = levSim >= FUZZY_THRESHOLD;
      const isTokMatch = tokSim >= 0.5; // Lower threshold for shared-word detection
      const bestSim = Math.max(levSim, tokSim);

      if (isLevMatch || isTokMatch) {
        const pairKey = [keyA, keyB].sort().join("|||");
        if (seen.has(pairKey)) continue;
        seen.add(pairKey);

        const nameA = findCanonicalName(rosterByKennel, keyA);
        const nameB = findCanonicalName(rosterByKennel, keyB);
        const kennels = [...new Set([...dataA.kennels, ...dataB.kennels])].sort();
        const matchType = tokSim > levSim ? "token" : "levenshtein";

        duplicates.push({
          names: [nameA, nameB],
          kennels,
          similarity: Math.round(bestSim * 100) / 100,
          counts: [dataA.totalCount, dataB.totalCount],
          matchType,
        });
      }
    }
  }

  duplicates.sort((a, b) => b.similarity - a.similarity);
  return duplicates;
}

function findCanonicalName(
  rosterByKennel: Map<string, HareEntry[]>,
  lowerName: string,
): string {
  for (const entries of rosterByKennel.values()) {
    const found = entries.find((e) => e.name.toLowerCase() === lowerName);
    if (found) return found.name;
  }
  return lowerName;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const fileIdx = args.indexOf("--file");

  let result: { events: RawEventData[]; errors: string[] };

  if (fileIdx !== -1) {
    // File mode: parse saved HTML files
    const files = args.slice(fileIdx + 1);
    if (files.length === 0) {
      console.error("Usage: npx tsx scripts/scrape-hashnyc-hares.ts --file <past.html> [future.html]");
      console.error("\nSave these pages from your browser:");
      console.error("  Past:   https://hashnyc.com/?days=365&backwards=true");
      console.error("  Future: https://hashnyc.com/?days=365");
      process.exit(1);
    }
    result = fetchFromFiles(files[0], files[1]);
  } else {
    // Live mode: fetch from hashnyc.com directly
    result = await fetchLive();
  }

  console.log(`\nTotal events fetched: ${result.events.length}`);
  if (result.errors.length > 0) {
    console.warn(`Scrape warnings (${result.errors.length}): ${result.errors.slice(0, 5).join("; ")}`);
    if (result.errors.length > 5) console.warn(`  ... and ${result.errors.length - 5} more`);
  }

  // Collect hare names by kennel
  const namesByKennel = new Map<string, string[]>();
  let eventsWithHares = 0;

  for (const event of result.events) {
    if (!event.hares) continue;
    eventsWithHares++;

    const kennel = event.kennelTag;
    if (!namesByKennel.has(kennel)) namesByKennel.set(kennel, []);

    const names = splitHareNames(event.hares);
    namesByKennel.get(kennel)!.push(...names);
  }

  console.log(`${eventsWithHares} events had hare data across ${namesByKennel.size} kennels`);

  // Build deduplicated roster
  const roster = buildRoster(namesByKennel);

  // Find potential duplicates
  const duplicates = findDuplicates(roster);

  // Build output
  let totalUniqueHares = 0;
  const kennels: Record<string, KennelRoster> = {};

  for (const [kennel, entries] of roster) {
    totalUniqueHares += entries.length;
    kennels[kennel] = {
      count: entries.length,
      hares: entries.map((e) => ({
        name: e.name,
        timesSeen: e.timesSeen,
        ...(e.variants.length > 0 ? { variants: e.variants } : {}),
      })),
    };
  }

  // Sort kennels alphabetically
  const sortedKennels: Record<string, KennelRoster> = {};
  for (const key of Object.keys(kennels).sort()) {
    sortedKennels[key] = kennels[key];
  }

  const output = {
    scrapedAt: new Date().toISOString().split("T")[0],
    lookbackDays: LOOKBACK_DAYS,
    totalEvents: result.events.length,
    eventsWithHares,
    totalUniqueHares,
    kennels: sortedKennels,
    possibleDuplicates: duplicates,
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2) + "\n");
  console.log(`\nWrote roster to ${OUTPUT_PATH}`);
  console.log(`  Total unique hares: ${totalUniqueHares}`);
  console.log(`  Kennels: ${Object.keys(sortedKennels).join(", ")}`);
  console.log(`  Possible duplicates flagged: ${duplicates.length}`);

  // Print summary per kennel
  console.log("\n── Per-Kennel Summary ──");
  for (const [kennel, data] of Object.entries(sortedKennels)) {
    console.log(`  ${kennel}: ${data.count} unique hares`);
  }

  if (duplicates.length > 0) {
    console.log("\n── Possible Duplicates (review manually) ──");
    for (const dup of duplicates.slice(0, 20)) {
      console.log(
        `  "${dup.names[0]}" ↔ "${dup.names[1]}" (${Math.round(dup.similarity * 100)}% ${dup.matchType ?? "similar"}, seen ${dup.counts[0]}/${dup.counts[1]} times, kennels: ${dup.kennels.join(", ")})`,
      );
    }
    if (duplicates.length > 20) {
      console.log(`  ... and ${duplicates.length - 20} more (see JSON output)`);
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
