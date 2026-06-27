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
const NEXT_LABEL = /(?=Run\s*#|Date\s*:|Hares?\s*:|Start\s*:|On\s*On\s*:|$)/i.source;
const DATE_RE = new RegExp(`Date\\s*:\\s*(.*?)\\s*${NEXT_LABEL}`, "i");
const HARES_RE = new RegExp(`Hares?\\s*:\\s*(.*?)\\s*${NEXT_LABEL}`, "i");
const START_RE = new RegExp(`Start\\s*:\\s*(.*?)\\s*${NEXT_LABEL}`, "i");
const ON_ON_RE = new RegExp(`On\\s*On\\s*:\\s*(.*?)\\s*${NEXT_LABEL}`, "i");

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
