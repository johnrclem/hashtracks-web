import type { Source } from "@/generated/prisma/client";
import type { ErrorDetails, RawEventData, ScrapeResult, SourceAdapter } from "../types";
import {
  applyDateWindow,
  chronoParseDate,
  cleanLocationName,
  fetchHTMLPage,
  formatAmPmTime,
  stripClickHereForMap,
} from "../utils";

/**
 * Sydney H3 ("Posh Hash") — sh3.link
 *
 * Founded 1967. The hareline lives at /?page_id=9470 inside `.entry.clr`,
 * with one `<p>` per upcoming run. Each `<p>` looks like:
 *
 *   Run #3069
 *   Date: 7th April – Tuesday Joint Run
 *   Hares: Harriettes
 *   Start: Carpark 87 Winbourne Rd, Brookvale CLICK HERE FOR MAP
 *   On On: Brookvale Hotel
 *
 * **CRITICAL**: WordPress WYSIWYG mangles the inline `<strong>` markup that
 * the editor uses for the labels (e.g. "Run #30" + text "7" + strong "0"),
 * so we have to parse from `$p.text()` (innerText) — NOT raw HTML. Once
 * collapsed to text the labels run together on a single line, so the
 * extraction is anchored on label keywords with non-greedy lookahead
 * boundaries to the next label.
 *
 * The page also publishes a "Next run on …" header `<p>` and a
 * "Next Few Weeks" divider `<p>` between the immediate run and the
 * upcoming runs — both are skipped because they have no `Run #` token.
 *
 * The page omits years from the "Date:" line. We resolve to the current
 * year via chrono with `forwardDate: true` so dates always project into
 * the future, then re-anchor against the prior parsed date when chrono
 * spits out a year that has clearly already rolled over (e.g. an "13th
 * April" parsed in late December).
 */

const KENNEL_TAG = "sh3-au";
const SOURCE_URL_DEFAULT = "https://www.sh3.link/?page_id=9470";

/**
 * Label extraction regexes. Each uses a non-greedy capture that stops at
 * the next known label anchor so the parser remains robust when the
 * WordPress innerText collapses every labeled field onto a single line.
 */
// Each label tolerates whitespace before its colon — the live page writes
// "On On :" (and occasionally "Start :") with a space, which the old
// colon-tight patterns missed. When "On On :" failed to match, the Start
// capture spilled to end-of-string, leaking the On-On venue + CTA into the
// location and dropping the On-On entirely (#2360 / #2362).
// Captures use `(.*?)` (zero-or-more) so an empty field whose next label sits
// immediately after it — e.g. "Hares: Start:" on an un-hared future run —
// captures "" and stops, instead of `(.+?)` skipping past the adjacent label
// and swallowing the following field's value (#2360).
//
// The "next label" boundary lookahead is inlined into each LITERAL regex below
// rather than composed via `new RegExp(...)`, so Codacy's detect-non-literal
// -regexp can see the pattern is fully controlled (the interpolated form is a
// flagged sink even though the input is a module constant). NOSONAR S5852: the
// lazy capture + boundary lookahead is the same bounded shape the other HTML
// scrapers use (e.g. chicago-hash).
const DATE_RE = /Date\s*:\s*(.*?)\s*(?=Run\s*#|Date\s*:|Hares?\s*:|Start\s*:|On\s*On\s*:|$)/i; // NOSONAR S5852
const HARES_RE = /Hares?\s*:\s*(.*?)\s*(?=Run\s*#|Date\s*:|Hares?\s*:|Start\s*:|On\s*On\s*:|$)/i; // NOSONAR S5852
const START_RE = /Start\s*:\s*(.*?)\s*(?=Run\s*#|Date\s*:|Hares?\s*:|Start\s*:|On\s*On\s*:|$)/i; // NOSONAR S5852
const ON_ON_RE = /On\s*On\s*:\s*(.*?)\s*(?=Run\s*#|Date\s*:|Hares?\s*:|Start\s*:|On\s*On\s*:|$)/i; // NOSONAR S5852

/**
 * Parse the start time the editors append to the Date cell as "@ 6:30pm" /
 * "@ 6:30 pm" / "@ 6pm" (#2361). Returns "HH:MM" or undefined when absent or
 * out of range. chrono parses the date and ignores this "@ time" suffix, so it
 * has to be recovered separately.
 */
const SH3_AT_TIME_RE = /@\s*(\d{1,2})(?::(\d{2}))?\s*([ap]m)/i;
function parseStartTimeFromDate(dateField: string): string | undefined {
  const m = SH3_AT_TIME_RE.exec(dateField);
  if (!m) return undefined;
  const h = Number.parseInt(m[1], 10);
  const min = m[2] ? Number.parseInt(m[2], 10) : 0;
  if (h < 1 || h > 12 || min > 59) return undefined;
  return formatAmPmTime(h, min, m[3]);
}

function captureLabel(text: string, re: RegExp): string | undefined {
  const m = re.exec(text);
  return m?.[1]?.trim() || undefined;
}

/**
 * Strip the "CLICK HERE FOR MAP" anchor text that the editors embed inline
 * inside the Start field, then tidy stray separators. Returns undefined when
 * the residual is empty.
 *
 * #1650: the previous implementation used `\bCLICK...\b.*$/i` which failed
 * on two production shapes:
 *   1. `"…Pennant HillsCLICK HERE FOR MAP…"` — there is no `\b` between two
 *      word characters (`s` → `C`), so the sentinel survived intact.
 *   2. `"…Pennant Hills CLICK HERE FOR MAP, Pennant Hills, NSW"` — `.*$`
 *      swallowed the valid city/state suffix after the link.
 * The replacement uses anchor-text-only stripping with whitespace + dangling
 * separator cleanup so address detail downstream of the link survives.
 * `stripClickHereForMap` is shared via `../utils` (also used by
 * `cleanLocationName`) so the procedural sentinel stripper lives in one place.
 */

function cleanStart(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  // Step 1: strip anchor text. The simple `CLICK\s*HERE\s*FOR\s*MAP`
  // pattern (per-token `\s*`) is linear but Sonar S5852 flags adjacent
  // `\s` quantifiers; the helper above sidesteps the heuristic and
  // recovers from false matches of the leading word "click".
  const stripped = stripClickHereForMap(raw);
  // Step 2: collapse internal runs of whitespace and strip junk around
  // commas. Procedural cleanup — no regex alternation in the trim loop.
  const tokens = stripped.split(/\s+/).filter((t) => t.length > 0);
  let joined = tokens.join(" ").replaceAll(" ,", ",");
  while (joined.length > 0 && (joined.startsWith(",") || joined.startsWith(" "))) {
    joined = joined.slice(1);
  }
  while (joined.length > 0 && (joined.endsWith(",") || joined.endsWith(" "))) {
    joined = joined.slice(0, -1);
  }
  return joined || undefined;
}

/**
 * Sanitize the captured Hares field by stripping inline URLs and the
 * promotional lead-in some scribes append to the same line (#1644). The
 * Sydney H3 editors often paste a JotForm shirt-order link on the line
 * immediately under `Hares:` — after `text()` collapses the paragraph the
 * promo trails the hare name with no obvious boundary.
 *
 * Heuristic: find the earliest truncation point and chop from there:
 *  - any `http(s)://…` URL token (always a promo signal in this position)
 *  - explicit two-word promo phrases (`Special Tshirt`, `Order here`,
 *    `Buy here`) that pair a promo modifier with a context word — `T-Shirt
 *    Bandit` as a hare name survives because there's no following promo
 *    modifier.
 *
 * Implemented procedurally with `indexOf` + `Math.min` instead of a single
 * regex with leading `\s*` adjacent to alternation, which trips Sonar's
 * S5852 ReDoS heuristic (Memory feedback_sonar_s5852_procedural_over_regex).
 */
const SH3_PROMO_PHRASES = [
  "Special Tshirt",
  "Special T-shirt",
  "Special T Shirt",
  "Order here",
  "Buy here",
];
const SH3_URL_RE = /https?:\/\/\S+/i;

function findFirstPromoIndex(text: string): number {
  let best = -1;
  const lower = text.toLowerCase();
  for (const phrase of SH3_PROMO_PHRASES) {
    const idx = lower.indexOf(phrase.toLowerCase());
    if (idx !== -1 && (best === -1 || idx < best)) best = idx;
  }
  const urlMatch = SH3_URL_RE.exec(text);
  if (urlMatch && (best === -1 || urlMatch.index < best)) best = urlMatch.index;
  return best;
}

const TRAILING_PUNCT = new Set(["-", "–", "—", " "]);

// Joint-run metadata the editors sometimes type into the Hares field instead
// of hare names (#2056 — run #3078: "Larrikins Joint Run 2500 – wear a tutu").
// A joint run lists the partner kennel + their run number + dress code, not
// trail-setters, so there are no real hares to recover — drop the whole field.
const JOINT_RUN_RE = /\bjoint\s+run\b/i;

// "Posh –" / "Posh -" / "Posh:" / "Posh Hash –" lead-in some scribes prefix to
// the hare line ("Posh" is the kennel's nickname, not a hare). Stripped only
// when a separator + more content follows, so a hare literally named "Posh"
// survives (#2363).
const POSH_PREFIX_RE = /^posh(?:\s+hash)?\s*[-–—:]\s*(?=\S)/i;

function cleanHares(raw: string | undefined): string | null | undefined {
  if (!raw) return undefined;
  // Recognized non-hare content → null (explicit clear), so a stale hare stored
  // for this run from an earlier scrape is wiped rather than preserved. The
  // merge tri-state reads undefined as "keep existing", null as "clear" (#2056).
  if (JOINT_RUN_RE.test(raw)) return null;
  const deprefixed = raw.replace(POSH_PREFIX_RE, "");
  const cutoff = findFirstPromoIndex(deprefixed);
  let cleaned = (cutoff !== -1 ? deprefixed.slice(0, cutoff) : deprefixed).trimEnd();
  // Collapse trailing punctuation left behind by truncation (en-dash, hyphen).
  while (cleaned.length > 0 && TRAILING_PUNCT.has(cleaned[cleaned.length - 1])) {
    cleaned = cleaned.slice(0, -1).trimEnd();
  }
  return cleaned || undefined;
}

/**
 * Parse a single Sydney H3 paragraph (innerText) into a RawEventData.
 * Returns null if the block lacks the two required fields (run number +
 * parseable date).
 *
 * Exported for unit testing.
 */
export function parseSh3Paragraph(
  text: string,
  sourceUrl: string,
  referenceDate: Date = new Date(),
  /** A date inferred from the run sequence, for a Date cell that names no real day. */
  dateOverride?: string,
): RawEventData | null {
  const runMatch = /Run\s*#\s*(\d+)/i.exec(text);
  if (!runMatch) return null;
  const runNumber = Number.parseInt(runMatch[1], 10);

  const dateField = captureLabel(text, DATE_RE);
  if (!dateField) return null;

  // The Date: cell often contains extra context after the date itself
  // (e.g. "7th April – Tuesday Joint Run"). chrono parses the leading
  // date and ignores the rest. forwardDate ensures bare "13th April"
  // resolves to the *next* April, not the past one. requireCertainDate
  // rejects a day that doesn't exist ("31st November", #2848): chrono would
  // otherwise fall back to the scrape day and file the run there.
  const date =
    dateOverride ?? chronoParseDate(dateField, "en-GB", referenceDate, { forwardDate: true, requireCertainDate: true });
  if (!date) return null;

  const startTime = parseStartTimeFromDate(dateField);
  const hares = cleanHares(captureLabel(text, HARES_RE));
  // Run the captured Start: value through the shared location cleaner so a
  // blank Start: (which lets the non-greedy capture spill into the trailing
  // "CLICK HERE FOR MAP" / next-label text) resolves to no location instead
  // of leaking anchor text or a sibling field's value (#1731). When the
  // Start: label IS present but cleans to nothing, keep the cleaner's `null`
  // so merge explicitly clears a stale value; only emit `undefined` (preserve)
  // when the run has no Start: label at all.
  const startLabelPresent = /Start\s*:/i.test(text);
  const start = startLabelPresent
    ? cleanLocationName(cleanStart(captureLabel(text, START_RE)))
    : undefined;
  const onOn = captureLabel(text, ON_ON_RE);

  return {
    date,
    kennelTags: [KENNEL_TAG],
    runNumber,
    hares,
    startTime,
    location: start,
    description: onOn,
    sourceUrl,
  };
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
// "31st November" → day 31, month "Nov". Bounded; no nested quantifiers.
const DAY_MONTH_RE = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]{0,6}\b/i;
const WEEK_MS = 7 * 86_400_000;

interface PendingRow { text: string; runNumber: number; day: number; month: number; stated: string }

/** Nearest dated run by run number, preferring the one before it. */
function nearestRun(events: RawEventData[], runNumber: number): RawEventData | undefined {
  let best: RawEventData | undefined;
  for (const e of events) {
    const d = Math.abs((e.runNumber ?? 0) - runNumber);
    const bestD = best ? Math.abs((best.runNumber ?? 0) - runNumber) : Infinity;
    if (d < bestD || (d === bestD && (e.runNumber ?? 0) < (best?.runNumber ?? 0))) best = e;
  }
  return best;
}

/** Anchor date + a week per run number, kept only if it lands in the stated month within 3 days. */
function inferFromSequence(anchor: RawEventData, row: PendingRow): string | undefined {
  const inferred = new Date(Date.parse(`${anchor.date}T12:00:00Z`) + (row.runNumber - (anchor.runNumber ?? 0)) * WEEK_MS);
  const fits = inferred.getUTCMonth() === row.month && Math.abs(inferred.getUTCDate() - row.day) <= 3;
  return fits ? inferred.toISOString().slice(0, 10) : undefined;
}

/**
 * Parse the hareline paragraphs. A Date cell naming a day that doesn't exist
 * ("31st November", #2848) is dated from the weekly run sequence instead: the
 * nearest run with a real date, plus a week per run number. The inferred date is
 * kept only when it falls in the stated month within 3 days of the stated day,
 * and every inference or skip is reported, never applied silently.
 *
 * Exported for unit testing.
 */
export function parseSh3Paragraphs(
  texts: string[],
  sourceUrl: string,
  referenceDate: Date = new Date(),
): { events: RawEventData[]; dateInferences: string[]; skippedInvalidDates: string[] } {
  const events: RawEventData[] = [];
  const pending: PendingRow[] = [];
  for (const text of texts) {
    const event = parseSh3Paragraph(text, sourceUrl, referenceDate);
    if (event) {
      events.push(event);
      continue;
    }
    const run = /Run\s*#\s*(\d+)/i.exec(text);
    const stated = DAY_MONTH_RE.exec(captureLabel(text, DATE_RE) ?? "");
    if (run && stated) {
      pending.push({
        text,
        runNumber: Number.parseInt(run[1], 10),
        day: Number.parseInt(stated[1], 10),
        month: MONTHS.indexOf(stated[2].toLowerCase()),
        stated: stated[0],
      });
    }
  }

  const dateInferences: string[] = [];
  const skippedInvalidDates: string[] = [];
  // Anchors must be near the scrape date: forwardDate rolls a just-past run
  // ("9th November" read on 10 Nov) into next year, which would skew the sequence.
  const anchors = events.filter((e) => Math.abs(Date.parse(`${e.date}T12:00:00Z`) - referenceDate.getTime()) < 120 * 86_400_000);
  for (const row of pending) {
    const anchor = nearestRun(anchors, row.runNumber);
    const inferred = anchor ? inferFromSequence(anchor, row) : undefined;
    const event = inferred ? parseSh3Paragraph(row.text, sourceUrl, referenceDate, inferred) : null;
    if (event && anchor) {
      events.push(event);
      dateInferences.push(
        `Run #${row.runNumber}: "${row.stated}" is not a real date; filed on ${event.date} from run #${anchor.runNumber} on ${anchor.date}`,
      );
    } else {
      skippedInvalidDates.push(`Run #${row.runNumber}: "${row.stated}" is not a real date and the run sequence gives no date in that month`);
    }
  }
  for (const message of [...dateInferences, ...skippedInvalidDates]) console.warn(`[sh3-au] ${message}`);
  return { events, dateInferences, skippedInvalidDates };
}

export class Sh3AuAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const url = source.url || SOURCE_URL_DEFAULT;
    const page = await fetchHTMLPage(url);
    if (!page.ok) return page.result;

    const paragraphs = page.$(".entry.clr > p");
    const texts: string[] = [];
    paragraphs.each((_i, el) => {
      const text = page.$(el).text().replace(/\s+/g, " ").trim();
      // Skip header paragraphs that have no `Run #` anchor.
      if (/Run\s*#/i.test(text)) texts.push(text);
    });
    const { events, dateInferences, skippedInvalidDates } = parseSh3Paragraphs(texts, url);

    // Surface zero-result scrapes as parse errors so the reconciler does
    // not cancel live events when the WordPress markup drifts.
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    if (events.length === 0) {
      const message = "Sydney H3 (sh3.link) scraper parsed 0 runs — possible WordPress format drift";
      errors.push(message);
      errorDetails.parse = [{ row: 0, error: message }];
    }

    const days = options?.days ?? source.scrapeDays ?? 180;
    return applyDateWindow(
      {
        events,
        errors,
        errorDetails: errors.length > 0 ? errorDetails : undefined,
        structureHash: page.structureHash,
        diagnosticContext: {
          fetchMethod: "html-scrape",
          paragraphsFound: paragraphs.length,
          eventsParsed: events.length,
          dateInferences,
          skippedInvalidDates,
          fetchDurationMs: page.fetchDurationMs,
        },
      },
      days,
    );
  }
}
