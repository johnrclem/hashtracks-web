import type { Source } from "@/generated/prisma/client";
import type { ErrorDetails, RawEventData, ScrapeResult, SourceAdapter } from "../types";
import { applyDateWindow, chronoParseDate, fetchHTMLPage } from "../utils";

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
const NEXT_LABEL = /(?=Run\s*#|Date:|Hares?:|Start:|On\s*On:|$)/i.source;
const DATE_RE = new RegExp(`Date:\\s*(.+?)\\s*${NEXT_LABEL}`, "i");
const HARES_RE = new RegExp(`Hares?:\\s*(.+?)\\s*${NEXT_LABEL}`, "i");
const START_RE = new RegExp(`Start:\\s*(.+?)\\s*${NEXT_LABEL}`, "i");
const ON_ON_RE = new RegExp(`On\\s*On:\\s*(.+?)\\s*${NEXT_LABEL}`, "i");

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
 */
function cleanStart(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  // S5852 NOSONAR markers — Sonar flags adjacent `\s` quantifiers in
  // string-literal patterns even when each is single-pass with no
  // overlap. No backtracking path exists for these patterns.
  const cleaned = raw
    .replace(/CLICK\s*HERE\s*FOR\s*MAP/gi, "") // NOSONAR S5852
    .replace(/\s+/g, " ")
    .replace(/\s+,/g, ",") // NOSONAR S5852
    .replace(/^[\s,]+|[\s,]+$/g, ""); // NOSONAR S5852
  return cleaned || undefined;
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

function cleanHares(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const cutoff = findFirstPromoIndex(raw);
  let cleaned = (cutoff !== -1 ? raw.slice(0, cutoff) : raw).trimEnd();
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
): RawEventData | null {
  const runMatch = /Run\s*#\s*(\d+)/i.exec(text);
  if (!runMatch) return null;
  const runNumber = Number.parseInt(runMatch[1], 10);

  const dateField = captureLabel(text, DATE_RE);
  if (!dateField) return null;

  // The Date: cell often contains extra context after the date itself
  // (e.g. "7th April – Tuesday Joint Run"). chrono parses the leading
  // date and ignores the rest. forwardDate ensures bare "13th April"
  // resolves to the *next* April, not the past one.
  const date = chronoParseDate(dateField, "en-GB", referenceDate, { forwardDate: true });
  if (!date) return null;

  const hares = cleanHares(captureLabel(text, HARES_RE));
  const start = cleanStart(captureLabel(text, START_RE));
  const onOn = captureLabel(text, ON_ON_RE);

  return {
    date,
    kennelTags: [KENNEL_TAG],
    runNumber,
    hares,
    location: start,
    description: onOn,
    sourceUrl,
  };
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

    const events: RawEventData[] = [];
    const paragraphs = page.$(".entry.clr > p");
    paragraphs.each((_i, el) => {
      const text = page.$(el).text().replace(/\s+/g, " ").trim();
      if (!text) return;
      // Skip header paragraphs that have no `Run #` anchor.
      if (!/Run\s*#/i.test(text)) return;
      const event = parseSh3Paragraph(text, url);
      if (event) events.push(event);
    });

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
          fetchDurationMs: page.fetchDurationMs,
        },
      },
      days,
    );
  }
}
