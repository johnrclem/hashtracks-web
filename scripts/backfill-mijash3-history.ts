/**
 * Mijas H3 (Costa del Sol "Burro Hash") historical backfill — run reports
 * gallery, 2019 → 2025.
 *
 * Context: the live adapter (`mijas-hash.ts`) scrapes only the current-year
 * hareline at mijash3.com/hareline. The kennel's deeper history lives in the
 * Squarespace "Run Reports & Gallery" blog collections — one page per year,
 * each post a run report. The handoff said no history was archived; that was
 * wrong. This script recovers it.
 *
 * Source of truth per report:
 *   - run number, date, and theme come from the post TITLE / slug, which is
 *     uniform across all years ("Run - 1998 - 28th December 2025 New years
 *     Run", "Run 1673 - 29 Dec 2019"). NEVER the `publishOn` timestamp — that
 *     is the publish date (often the day after the run).
 *   - hares + location are extracted best-effort from the hand-written body
 *     prose via labelled-field capture. The prose has no consistent delimiter,
 *     so when a value can't be cleanly bounded it's left undefined rather than
 *     polluted with trailing "Number of Hounds: 18" noise.
 *
 * Data access: Squarespace's `?format=json-pretty` view returns each
 * collection's items (title, urlId, body, fullUrl) plus pagination, so a
 * handful of JSON fetches replace hundreds of per-report HTML scrapes.
 *
 * Bound to the existing "Mijas H3 Hareline" source: same kennel, same site,
 * same HTML_SCRAPER type. Safe because that source is `upcomingOnly` — its
 * reconcile window is future-only, so these past-dated rows are never
 * cancellation candidates, and there is no date overlap with the live
 * current-year hareline. Routed through the merge pipeline (idempotent on
 * fingerprint), so re-runs are safe.
 *
 * Usage:
 *   Dry run:   npx tsx scripts/backfill-mijash3-history.ts
 *   Apply:     BACKFILL_APPLY=1 npx tsx scripts/backfill-mijash3-history.ts
 *   Env:       DATABASE_URL
 */

import "dotenv/config";
import type { RawEventData } from "@/adapters/types";
import { safeFetch } from "@/adapters/safe-fetch";
import {
  chronoParseDate,
  normalizeHaresField,
  cleanLocationName,
  stripHtmlTags,
} from "@/adapters/utils";
import { prisma } from "@/lib/db";
import { runBackfillScript } from "./lib/backfill-runner";

const SOURCE_NAME = "Mijas H3 Hareline";
const KENNEL_TAG = "mijash3";
const KENNEL_TIMEZONE = "Europe/Madrid";
const ORIGIN = "https://www.mijash3.com";

/** Year collection landing paths (slugs differ per year on the live site). */
const YEAR_PATHS = [
  "/runreports-2019",
  "/run-reports-2020",
  "/run-reports2021",
  "/run-reports-2022",
  "/run-reports-2023",
  "/run-reports-2024",
  "/run-reports-gallery-2025",
];

const POLITENESS_DELAY_MS = 400;
const MAX_PAGES_PER_YEAR = 20; // safety bound against a pagination loop

/**
 * Locates a `DD[th] <word> YYYY` date shape. The month is matched loosely as a
 * 3–9 letter word rather than a 12-way alternation (which tripped Sonar's regex
 * complexity limit) — chronoParseDate does the real month validation on the
 * matched slice and returns null for non-dates, so a loose word is safe.
 */
const DATE_RE = /\d{1,2}(?:st|nd|rd|th)?[\s-]+[a-z]{3,9}[\s-]+\d{4}/i;

/**
 * Labels that mark the start of the NEXT field in a report body. A captured
 * value (hares, location) ends at the earliest of these — this is what stops
 * "La Cala" from swallowing "Number of Hounds: 18".
 */
// Matched case-insensitively as substrings, so the shortest distinctive form
// covers its variants ("Hare" → "Hares", "Number" → "Number of Hounds",
// "Runner" → "Runners"). "Run Number" is kept separately so a value stops
// before "Run", not mid-phrase at "Number".
const STOP_LABELS = [
  "Run Number",
  "Number",
  "Marks",
  "Hare",
  "Location",
  "Visitors",
  "Virgin",
  "Pack size",
  "Hasher",
  "Hounds",
  "Runner",
  "Hash Flash",
  "Scribe",
  "Score",
  "Date",
  "Anniversar",
  "On On",
  "On-On",
];

/**
 * Labelled fields are only trusted inside the report's structured header
 * region. Beyond this, "location"/"hare" recur in the narrative prose and
 * produce false captures ("on a hill top. Well done").
 */
const HEADER_SCAN_CHARS = 800;

interface SqsItem {
  title?: string;
  urlId?: string;
  fullUrl?: string;
  body?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchYearItems(path: string): Promise<SqsItem[]> {
  const items: SqsItem[] = [];
  let url = `${ORIGIN}${path}?format=json-pretty`;
  const seenOffsets = new Set<string>();

  // Fail loud on any incomplete traversal: a one-shot historical backfill that
  // silently applies a partial archive (transient 500 / rate-limit / stuck
  // cursor mid-pagination) leaves permanent gaps that are hard to notice. Only
  // a clean `nextPage === false` terminates the loop normally.
  for (let page = 0; page < MAX_PAGES_PER_YEAR; page++) {
    const res = await safeFetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Backfill)" },
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) {
      throw new Error(`[${path}] HTTP ${res.status} on page ${page} — aborting (incomplete archive)`);
    }
    const data = (await res.json()) as {
      items?: SqsItem[];
      pagination?: { nextPage?: boolean; nextPageOffset?: number };
    };
    for (const it of data.items ?? []) items.push(it);

    const next = data.pagination;
    // Clean end: the terminal page omits `nextPage` entirely (Squarespace does
    // NOT send `nextPage: false` — verified against the 2019 collection's last
    // page), so a falsy nextPage is the real end signal.
    if (!next?.nextPage) return items;
    // nextPage is truthy but there's no offset to advance — a truncated/malformed
    // response. Fail loud rather than silently returning a partial archive.
    if (next.nextPageOffset == null) {
      throw new Error(`[${path}] nextPage=true but no nextPageOffset — aborting (truncated response)`);
    }
    const offset = String(next.nextPageOffset);
    if (seenOffsets.has(offset)) {
      throw new Error(`[${path}] repeated pagination offset ${offset} — aborting (stuck cursor)`);
    }
    seenOffsets.add(offset);
    url = `${ORIGIN}${path}?format=json-pretty&offset=${offset}`;
    await sleep(POLITENESS_DELAY_MS);
  }
  throw new Error(`[${path}] exceeded ${MAX_PAGES_PER_YEAR} pages without reaching the end — aborting`);
}

const RUN_NUMBER_RE = /run[\s-]*(\d{3,4})\b/i;

/** Run number from the title or slug ("Run - 1998 …" / "run-1998-…"). */
export function parseRunNumber(title: string, urlId: string): number | undefined {
  const m = RUN_NUMBER_RE.exec(`${title} ${urlId}`);
  return m ? Number.parseInt(m[1], 10) : undefined;
}

/**
 * Parse the run date + trailing theme from the title (falling back to the
 * slug). The title carries the RUN date; the leading "Run - NNNN -" is
 * stripped first so the run number can't be mistaken for the date.
 */
export function parseDateAndTheme(
  title: string,
  urlId: string,
  referenceDate = new Date(),
): { date: string | null; theme?: string } {
  const stripped = title.replace(/^[\s-]*run[\s-]*\d{3,4}[\s-]*/i, "").trim();
  for (const candidate of [stripped, urlId.replaceAll("-", " ")]) {
    const m = DATE_RE.exec(candidate);
    if (m?.index === undefined) continue;
    const date = chronoParseDate(m[0].replaceAll("-", " "), "en-GB", referenceDate);
    if (!date) continue;
    const theme = candidate.slice(m.index + m[0].length).trim();
    return { date, theme: theme.length > 0 ? theme : undefined };
  }
  return { date: null };
}

/** Earliest index of any STOP_LABEL at or after `from`, or text length. */
function nextStopIndex(text: string, from: number): number {
  let best = text.length;
  const hay = text.toLowerCase();
  for (const label of STOP_LABELS) {
    const idx = hay.indexOf(label.toLowerCase(), from);
    if (idx >= 0 && idx < best) best = idx;
  }
  return best;
}

/**
 * Best-effort capture of a labelled field's value, bounded by the next field
 * label. Returns undefined when the label is absent or the value is empty.
 */
const FIELD_SEPARATORS = new Set([":", ".", "-", "–", "—"]);
const REJECT_VALUES = new Set(["no data", "na", "n/a", "none", "tba", "tbc", "tbd", "unknown"]);

/**
 * Capture the value at one label occurrence ending at `labelEnd`. Returns null
 * unless a real field separator (":"/"."/"-") follows — so narrative mentions
 * ("the Hares had laid…") are rejected — and the cleaned value is non-empty,
 * short enough, and not a placeholder.
 */
function captureLabeledValue(bodyText: string, labelEnd: number): string | null {
  let j = labelEnd;
  while (j < bodyText.length && bodyText[j] === " ") j++;
  if (!FIELD_SEPARATORS.has(bodyText[j])) return null;
  while (j < bodyText.length && (bodyText[j] === " " || FIELD_SEPARATORS.has(bodyText[j]))) j++;
  const value = cleanFieldValue(bodyText.slice(j, nextStopIndex(bodyText, j)));
  const ok = value.length > 0 && value.length <= 120 && !REJECT_VALUES.has(value.toLowerCase());
  return ok ? value : null;
}

export function extractField(bodyText: string, labels: string[]): string | undefined {
  const hay = bodyText.slice(0, HEADER_SCAN_CHARS).toLowerCase();
  for (const label of labels) {
    const lower = label.toLowerCase();
    for (let at = hay.indexOf(lower); at >= 0; at = hay.indexOf(lower, at + 1)) {
      const value = captureLabeledValue(bodyText, at + label.length);
      if (value !== null) return value;
    }
  }
  return undefined;
}

/** Title-ish abbreviations whose trailing period must NOT end the value. */
const ABBREVIATIONS = new Set(["st", "dr", "sr", "sra", "mr", "mrs", "ms", "mt", "ave", "rd", "jr"]);

/**
 * Tidy a captured field value: truncate at the first sentence period (bounds
 * run-on narrative like "Yogi and Bad Weasel.It all started…" and trailing
 * counts like "Sir Flakey. 44 Runners") and strip leading/trailing
 * punctuation/dash artifacts ("– Little Big Horn", "; Sir Flakey", "La Cala.").
 * A period after a known abbreviation ("St. Anthony", "Dr. Foo") is NOT a
 * boundary, so legitimate names/venues survive.
 */
export function cleanFieldValue(raw: string): string {
  let cut = raw.length;
  for (let i = raw.indexOf("."); i >= 0; i = raw.indexOf(".", i + 1)) {
    const precedingToken = raw.slice(0, i).split(/\s/).pop()?.toLowerCase() ?? "";
    if (!ABBREVIATIONS.has(precedingToken)) {
      cut = i;
      break;
    }
  }
  // Trim surrounding punctuation/dash artifacts procedurally — avoids an
  // anchored quantifier regex (Sonar flags `[...]+$` as a ReDoS shape even
  // though a single char-class is linear). Leading set excludes "." so a
  // legitimate leading abbreviation isn't shaved; trailing set includes it.
  const LEAD = " \t\n\r-–—;:,";
  const TAIL = " \t\n\r-–—;:,.";
  const sliced = raw.slice(0, cut);
  let a = 0;
  let b = sliced.length;
  while (a < b && LEAD.includes(sliced[a])) a++;
  while (b > a && TAIL.includes(sliced[b - 1])) b--;
  return sliced.slice(a, b);
}

function bodyToText(bodyHtml: string): string {
  // stripHtmlTags decodes entities + drops script/style; collapse to one line
  // so labelled fields can be scanned without newline boundaries.
  return stripHtmlTags(bodyHtml, " ").replace(/\s+/g, " ").trim();
}

/** Titles occasionally carry raw entities/tags ("… &amp; Towel Day</span>"). */
function cleanTitle(rawTitle: string): string {
  return bodyToText(rawTitle);
}

function itemToEvent(it: SqsItem, referenceDate: Date): RawEventData | null {
  const title = cleanTitle(it.title ?? "");
  const urlId = it.urlId ?? "";
  const runNumber = parseRunNumber(title, urlId);
  const { date, theme } = parseDateAndTheme(title, urlId, referenceDate);
  if (!date) return null;

  const bodyText = it.body ? bodyToText(it.body) : "";
  // Split only on explicit separators ("&" / ","). The body prose often reads
  // "X and daughter Y and helpful partner" — splitting on " and " would shred
  // that into sorted fragments, so capture it verbatim as one entry instead.
  // extractField already trims trailing punctuation via cleanFieldValue;
  // here we only un-mangle double-encoded "&amp;amp;" residue. normalizeHaresField
  // trims each split part, so no extra trailing-strip is needed.
  const haresRaw = extractField(bodyText, ["Hares", "Hare"])?.replace(/&?amp;/gi, "&");
  const hares = haresRaw ? normalizeHaresField(haresRaw.split("&").join(",")) : undefined;
  // Preserve cleanLocationName's tri-state: undefined when the Location label
  // is absent (preserve existing), else its result — which may be null
  // (explicit clear of a placeholder) or a cleaned string. Collapsing null to
  // undefined would silently keep a stale location on re-run.
  const rawLocation = extractField(bodyText, ["Location"]);
  const location = rawLocation === undefined ? undefined : cleanLocationName(rawLocation);

  return {
    date,
    kennelTags: [KENNEL_TAG],
    runNumber,
    title: theme && theme.length > 0 ? theme : undefined,
    hares,
    location,
    sourceUrl: it.fullUrl ? `${ORIGIN}${it.fullUrl}` : `${ORIGIN}/run-reports-gallery-2025`,
  };
}

function logVerboseEvents(events: RawEventData[]): void {
  for (const e of [...events].sort((a, b) => a.date.localeCompare(b.date))) {
    console.log(
      `  ${e.date} #${e.runNumber ?? "?"} | ${e.title ?? "—"} | hares=${e.hares ?? "—"} | loc=${e.location ?? "—"}`,
    );
  }
}

async function fetchEvents(): Promise<RawEventData[]> {
  const referenceDate = new Date();
  const byKey = new Map<string, RawEventData>();
  let totalItems = 0;
  let unparseable = 0;

  for (const path of YEAR_PATHS) {
    const items = await fetchYearItems(path);
    totalItems += items.length;
    for (const it of items) {
      const event = itemToEvent(it, referenceDate);
      if (!event) {
        unparseable++;
        continue;
      }
      // Dedup across pages/years by run number (fallback to date).
      const key = event.runNumber == null ? `d${event.date}` : `r${event.runNumber}`;
      if (!byKey.has(key)) byKey.set(key, event);
    }
    console.log(`  ${path}: ${items.length} items`);
    await sleep(POLITENESS_DELAY_MS);
  }

  const events = [...byKey.values()];
  const withHares = events.filter((e) => e.hares).length;
  const withLoc = events.filter((e) => e.location).length;
  console.log(
    `\n  Parsed ${events.length} unique runs from ${totalItems} items ` +
      `(${unparseable} unparseable). hares=${withHares} location=${withLoc}`,
  );
  if (process.env.BACKFILL_VERBOSE === "1") logVerboseEvents(events);
  return events;
}

/**
 * Apply-mode preflight: the whole "bind history to the live source" plan is
 * only safe while that source is `upcomingOnly` (reconcile window = future
 * only) AND linked to the Mijas kennel. Seed drift or an admin edit could
 * silently break that invariant, so verify it against the live DB before any
 * write rather than trusting the comment.
 */
async function assertReconcileSafe(): Promise<void> {
  const source = await prisma.source.findFirst({
    where: { name: SOURCE_NAME },
    select: { config: true, kennels: { select: { kennel: { select: { kennelCode: true } } } } },
  });
  if (!source) {
    throw new Error(`Source "${SOURCE_NAME}" not found — run prisma db seed first.`);
  }
  const upcomingOnly = (source.config as Record<string, unknown> | null)?.upcomingOnly === true;
  if (!upcomingOnly) {
    throw new Error(
      `Reconcile-safety preflight failed: source "${SOURCE_NAME}" is not upcomingOnly. ` +
        `Applying past-dated history under a full-window reconcile source risks false CANCELs. Aborting.`,
    );
  }
  const codes = source.kennels.map((k) => k.kennel.kennelCode);
  if (!codes.includes(KENNEL_TAG)) {
    throw new Error(
      `Reconcile-safety preflight failed: source "${SOURCE_NAME}" is not linked to "${KENNEL_TAG}" (linked: ${codes.join(", ") || "none"}).`,
    );
  }
}

if (process.argv[1]?.endsWith("backfill-mijash3-history.ts")) {
  (async () => {
    if (process.env.BACKFILL_APPLY === "1") await assertReconcileSafe();
    await runBackfillScript({
      sourceName: SOURCE_NAME,
      kennelTimezone: KENNEL_TIMEZONE,
      label: "Walking Mijas H3 run-reports gallery (2019–2025)",
      fetchEvents,
    });
  })().catch((err: unknown) => {
    console.error("FAILED:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
