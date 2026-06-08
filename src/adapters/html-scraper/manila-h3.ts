import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";
import { fetchHTMLPage, stripHtmlTags, MONTHS } from "../utils";

/**
 * Manila Hash House Harriers (MH3) — Manila, Philippines.
 *
 * HashTracks' first Philippines kennel: the Monday men's hash, "since 1972".
 * Scrapes the bilingual Tagalog/English Google Sites home page, which
 * server-renders ONLY the current "next run" as a block of label lines:
 *
 *   ano (what):  - mmdccxxviii = 2728       ← run number (roman = decimal)
 *   kailan (when): - sikoklokmon08jun26      ← encoded date token (…DDmonYY)
 *   sino (who): perverse arse likkr          ← hares
 *   saan (where) - <venue, street address>   ← location
 *   mapa: https://tinyurl.com/…              ← Maps shortlink
 *
 * Google Sites wraps every block in deeply nested divs with rotating, opaque
 * class names AND splits words across inline <span>s (e.g. "mmd"+"ccxxviii",
 * "saan (whe"+"re)"). `stripHtmlTags(html, "\n")` only inserts separators at
 * block/<br> boundaries — not at </span> — so it re-joins each label+value
 * onto one logical line. The parser therefore keys entirely on the visible
 * bilingual label prefix, never on CSS selectors (same approach as nswhhh.ts).
 *
 * This is a single next-run-only page (no pagination, no reachable archive):
 * `config.upcomingOnly: true` protects reconcile as the run ages off, and a
 * mandatory fail-loud guard surfaces markup/format drift instead of silently
 * emitting `events: []` (which the zero-event health alert can't catch on a
 * brand-new source whose baseline is already 0).
 */

// Bilingual label prefixes. `\s*` adjacent to a literal keeps each regex linear
// (Sonar S5852). Note `saan (where)` has NO trailing colon on the live page.
const ANO_RE = /ano\s*\(what\)/i; // run-number line (anchor)
const KAILAN_RE = /kailan\s*\(when\)/i; // date line
const SINO_RE = /sino\s*\(who\)/i; // hares line
const SAAN_RE = /saan\s*\(where\)/i; // location line
const MAPA_RE = /^mapa\s*:/i; // Maps shortlink line

// "= 2728" — take the decimal after the equals sign (simple + linear).
const RUN_RE = /=\s*(\d{2,5})\b/;
// Roman-numeral fallback token (≥2 chars) when no decimal is published.
const ROMAN_TOKEN_RE = /\b([ivxlcdm]{2,})\b/i;
// Encoded date core "…08jun26" → day / 3-letter month / 2-digit year. The
// decorative weekday/time prefix ("sikoklokmon") carries no digits, so the
// first digit run anchors the match.
const DATE_CORE_RE = /(\d{1,2})([a-z]{3})(\d{2})/i;
// First URL in a line (Maps shortlink).
const URL_RE = /(https?:\/\/\S+)/i;
// Leading " - " / ":" separator left after stripping a label.
const LEADING_SEP_RE = /^\s*[-:]\s*/;

const ROMAN_VALUES: Record<string, number> = {
  i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000,
};

/** Convert a lowercase roman-numeral token to an integer (subtractive notation). */
function romanToInt(token: string): number | undefined {
  const s = token.toLowerCase();
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const cur = ROMAN_VALUES[s[i]];
    if (!cur) return undefined;
    const next = ROMAN_VALUES[s[i + 1]];
    total += next && cur < next ? -cur : cur;
  }
  return total > 0 ? total : undefined;
}

/** Run number from "ano (what): - mmdccxxviii = 2728": decimal first, roman fallback. */
function parseRunNumber(line: string): number | undefined {
  const dec = RUN_RE.exec(line);
  if (dec) return Number.parseInt(dec[1], 10);
  const roman = ROMAN_TOKEN_RE.exec(line);
  return roman ? romanToInt(roman[1]) : undefined;
}

/** Date (UTC noon) from "kailan (when): - sikoklokmon08jun26", or null on drift. */
function parseRunDate(line: string): string | null {
  const m = DATE_CORE_RE.exec(line);
  if (!m) return null;
  const day = Number.parseInt(m[1], 10);
  const month = MONTHS[m[2].toLowerCase()];
  const year = 2000 + Number.parseInt(m[3], 10);
  if (!month || day < 1 || day > 31) return null;
  const utc = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  // Round-trip rejects impossible dates (e.g. 31 in a 30-day month).
  if (utc.getUTCDate() !== day || utc.getUTCMonth() !== month - 1) return null;
  return utc.toISOString().slice(0, 10);
}

/** Strip a matched label prefix and the leading " - " / ":" separator. */
function labelValue(line: string, labelRe: RegExp): string {
  return line.replace(labelRe, "").replace(LEADING_SEP_RE, "").trim();
}

/** Maps shortlink from the "mapa:" line (raw URL is always visible text). */
function extractMapUrl(block: string[]): string | undefined {
  const mapaLine = block.find((l) => MAPA_RE.test(l));
  return mapaLine ? URL_RE.exec(mapaLine)?.[1] : undefined;
}

/**
 * Parse the current-run block from the Manila H3 home page.
 */
export function parseManilaH3Page(
  html: string,
  sourceUrl: string,
): { event: RawEventData | null; error?: string } {
  const lines = stripHtmlTags(html, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const anoIdx = lines.findIndex((line) => ANO_RE.test(line));
  if (anoIdx === -1) {
    return { event: null, error: "no 'ano (what)' run block found on page" };
  }

  // The sibling labels sit immediately below the run-number line; a bounded
  // window keeps prose/roster text (which never carries these labels) out.
  const block = lines.slice(anoIdx, anoIdx + 15);
  const runNumber = parseRunNumber(lines[anoIdx]);

  const dateLine = block.find((line) => KAILAN_RE.test(line));
  const date = dateLine ? parseRunDate(dateLine) : null;
  if (!date) {
    return { event: null, error: `could not extract date for Run #${runNumber ?? "?"}` };
  }

  const sinoLine = block.find((line) => SINO_RE.test(line));
  const saanLine = block.find((line) => SAAN_RE.test(line));

  return {
    event: {
      date,
      kennelTags: ["mh3-ph"],
      runNumber,
      // title intentionally undefined → merge.ts synthesizes "Manila H3 Trail #N".
      hares: sinoLine ? labelValue(sinoLine, SINO_RE) || undefined : undefined,
      location: saanLine ? labelValue(saanLine, SAAN_RE) || undefined : undefined,
      locationUrl: extractMapUrl(block),
      sourceUrl,
    },
  };
}

/**
 * Manila Hash House Harriers (MH3) HTML Scraper.
 *
 * Fetches the Google Sites home page (static SSR — no browser render needed).
 * Daily scrape catches each week's Monday run; fingerprint dedup handles repeat
 * scrapes between updates. A single content block with quirky encoded fields →
 * fail loud on parse drift so reconcile is suppressed and the failure surfaces.
 */
export class ManilaH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  // `options.days` is intentionally ignored: the home page renders exactly one
  // event (the current week's run) with no date-range concept to filter.
  async fetch(source: Source, _options?: { days?: number }): Promise<ScrapeResult> {
    const url = source.url || "https://sites.google.com/site/manilah3/manila-hash-house-harriers";
    const page = await fetchHTMLPage(url);
    if (!page.ok) return page.result;

    const { html, structureHash, fetchDurationMs } = page;
    const { event, error } = parseManilaH3Page(html, url);

    if (!event) {
      return {
        events: [],
        errors: [error ?? "Manila H3: no run block parsed"],
        structureHash,
        diagnosticContext: { fetchDurationMs },
      };
    }

    return {
      events: [event],
      errors: [],
      structureHash,
      diagnosticContext: { eventsParsed: 1, fetchDurationMs },
    };
  }
}
