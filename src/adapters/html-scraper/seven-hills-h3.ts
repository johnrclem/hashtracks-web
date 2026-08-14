import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import { fetchHTMLPage, chronoParseDate, parse12HourTime, decodeEntities } from "../utils";

/**
 * Seven Hills Hash House Harriers (7H4) Google Sites adapter.
 *
 * sites.google.com/view/7h4/home renders exactly one trail at a time — the
 * current/upcoming one, with labeled fields (TRAIL #N, Hares:, Start:, etc.).
 * This adapter complements the STATIC_SCHEDULE source (which generates
 * synthetic weekly Wednesday events) by emitting a single enriched event per
 * scrape. The merge pipeline will prefer this source's values whenever the
 * dates match.
 *
 * Page structure (trimmed): all the data lives in body text once the Google
 * Sites chrome is stripped, so we flatten the body to a single string and
 * run labeled-field regexes against it. The surface is small and stable.
 *
 * Issues: #508 (stale titles), #509 (missing fields), #510 (source gap),
 * #511 (Saturday specials via the current-trail slot).
 */

/** "TRAIL #2005" (older layout) or "Trail 2028" (live layout as of #2663,
 *  verified 2026-08-13 — the site dropped the "#"). A single `[\s#]*`
 *  class (rather than `\s*#?\s*`) avoids the adjacent-optional-quantifier
 *  shape Sonar flags as super-linear (S8786) while matching the same
 *  practical inputs. */
const TRAIL_NUMBER_RE = /TRAIL[\s#]*(\d+)/i;
/** Day names used for injecting a split before the date phrase. */
const DATE_SPLIT_RE = /(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/g;
/** Known field labels on the 7H4 page that need a preceding newline so value regexes don't run past them. */
const FIELD_LABEL_SPLIT_RE = /(When:|Start:|Hares?:|Beer\s*Meister:|Cost:|Shiggy\s*Level:|Special\s*Instructions:|On[\s-]*On)/g;
/** "August 12, 2026" (live layout as of #2663, verified 2026-08-13 — the
 *  site dropped the leading day-of-week the older "Saturday April 4, 2026"
 *  layout had). Matches ONLY the month/day/year — the optional leading
 *  day-name is detected separately via {@link DAY_NAME_SUFFIX_RE} so this
 *  regex isn't also carrying a 7-way alternation nested inside an optional
 *  group. Combining both into one regex measured Sonar complexity 28 (limit
 *  20, S5843); splitting them keeps each well under that on its own. */
const MONTH_DAY_YEAR_RE = /((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})/i;
/** Matches a day-of-week (+ optional comma/whitespace) ONLY when it's the
 *  last thing before the string end — used to check whether the text
 *  immediately preceding a {@link MONTH_DAY_YEAR_RE} match is a day name,
 *  so the trail-NAME boundary can be placed before it (see
 *  parseSevenHillsPage). Split out from MONTH_DAY_YEAR_RE for the same
 *  Sonar S5843 complexity reason. */
const DAY_NAME_SUFFIX_RE = /(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+$/i;
/** "@ 2pm" (older layout) or "6:30p.m." with no "@" at all (live layout as
 *  of #2663, verified 2026-08-13). The "@" is optional; the trailing
 *  am/pm suffix is the real anchor so this stays safe against false
 *  matches elsewhere in the body text. Minutes optional either way.
 *  Captured time is normalized into `HH:MM am/pm` before parsing. A single
 *  `[@\s]*` class (rather than `@?\s*`) avoids the adjacent-optional-
 *  quantifier shape Sonar flags as super-linear (S8786), same fix as
 *  TRAIL_NUMBER_RE above. */
const TIME_AT_RE = /[@\s]*(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)/i;
/** "Hares: Frodo & Snatch" — up to the next line / label / EOD. */
const HARES_RE = /Hares?:\s*([^\n]+)/i;
/** "Start: 442 S Five Forks Road Monroe, VA" — up to the next line / label / EOD. */
const START_RE = /Start:\s*([^\n]+)/i;

interface ParsedTrail {
  runNumber?: number;
  title?: string;
  date: string;
  startTime?: string;
  hares?: string;
  location?: string;
}

/**
 * Extract the one upcoming trail from the 7H4 Google Sites HTML. Returns null
 * if the page doesn't contain a recognizable trail block (e.g., during a
 * between-trails lull or a page redesign).
 */
export function parseSevenHillsPage(html: string): ParsedTrail | null {
  const $ = cheerio.load(html);
  // Live page glues labeled fields together with no whitespace. Inject
  // newlines before known labels so single-line value regexes terminate.
  const bodyText = decodeEntities($("body").text())
    .replaceAll(/\s+/g, " ")
    .replaceAll(FIELD_LABEL_SPLIT_RE, "\n$1")
    .replaceAll(DATE_SPLIT_RE, "\n$1")
    .trim();

  const trailMatch = TRAIL_NUMBER_RE.exec(bodyText);
  if (!trailMatch) return null;
  const runNumber = Number.parseInt(trailMatch[1], 10);

  // Search only the text AFTER "TRAIL #N" / "Trail N" for the date/time/
  // hares/location fields. The page's "About Hashing" prose above the trail
  // block contains the club's founding date ("began in Lynchburg, Virginia
  // on June 21, 1992") with no leading day-of-week — an unanchored
  // MONTH_DAY_YEAR_RE search on the WHOLE body text would match that 1992
  // founding date instead of the actual upcoming trail date (#2663).
  // Anchoring to after the trail number guarantees we only ever see the
  // current trail's own field block.
  const trailBlockStart = trailMatch.index + trailMatch[0].length;
  const trailBlock = bodyText.slice(trailBlockStart);

  const dateMatchInBlock = MONTH_DAY_YEAR_RE.exec(trailBlock);
  if (!dateMatchInBlock) return null;
  const date = chronoParseDate(dateMatchInBlock[1], "en-US", new Date(), { forwardDate: true });
  if (!date) return null;

  // The older layout prefixes the month/day/year with a day-of-week
  // ("Saturday April 4, 2026"); the live layout doesn't. When present, the
  // trail-NAME boundary belongs before the day name, not before the month —
  // otherwise the day name leaks into the extracted title. Checked as a
  // separate end-anchored regex against the text before the date match
  // (see DAY_NAME_SUFFIX_RE for why this isn't folded into one regex).
  const textBeforeDate = trailBlock.slice(0, dateMatchInBlock.index);
  const dayNameMatch = DAY_NAME_SUFFIX_RE.exec(textBeforeDate);
  const dateBlockStart = dayNameMatch
    ? dateMatchInBlock.index - dayNameMatch[0].length
    : dateMatchInBlock.index;

  // Search for the time ONLY in the span between the end of the date match
  // and the next injected field-label newline (FIELD_LABEL_SPLIT_RE puts one
  // before "Start:"/"Hares:"/etc.) — i.e. exactly the text that trails the
  // "When:"/date line, never further into the block. Making "@" optional on
  // TIME_AT_RE (#2663, to match the live "6:30p.m." no-"@" layout) otherwise
  // lets it match ANY am/pm-shaped text in the whole trail block — e.g. a
  // later "Special Instructions: On-after starts at 8pm" mention — and
  // misreport the on-after time as the trail start time when the "When:"
  // line itself carries no time (PR review finding, verified live-shaped).
  const afterDateStart = dateMatchInBlock.index + dateMatchInBlock[0].length;
  const nextLabelBreak = trailBlock.indexOf("\n", afterDateStart);
  const timeSearchZone = trailBlock.slice(
    afterDateStart,
    nextLabelBreak === -1 ? undefined : nextLabelBreak,
  );

  // parse12HourTime requires explicit minutes, so synthesize ":00" for the "2pm" short form.
  const timeMatch = TIME_AT_RE.exec(timeSearchZone);
  let startTime: string | undefined;
  if (timeMatch) {
    const hour = timeMatch[1];
    const minutes = timeMatch[2] ?? "00";
    // Strip dots so a source-side `@ 2 p.m.` still parses — parse12HourTime's
    // ampm group doesn't accept the dotted form.
    const ampm = timeMatch[3].replace(/\./g, "");
    startTime = parse12HourTime(`${hour}:${minutes} ${ampm}`);
  }

  const haresMatch = HARES_RE.exec(trailBlock);
  const hares = haresMatch?.[1]?.trim() || undefined;

  const startMatch = START_RE.exec(trailBlock);
  const location = startMatch?.[1]?.trim() || undefined;

  // Trail name sits between "TRAIL #N" and the date phrase, decorated with emoji
  // and stray punctuation that we strip for display.
  // Collapse injected \n separators back to spaces, then strip any trailing field
  // label (e.g. "When: ") that FIELD_LABEL_SPLIT_RE may have placed before the date
  // phrase. Splitting at \n[0] is wrong: DATE_SPLIT_RE also injects \n before day
  // names, so a title like "Saturday Night Fever Trail" would be truncated.
  let title: string | undefined;
  const nameStart = trailBlockStart;
  const nameEnd = trailBlockStart + dateBlockStart;
  if (nameEnd > nameStart) {
    const rawName = bodyText.slice(nameStart, nameEnd)
      .replaceAll(/\s+/g, " ")
      .replace(/\s+(?:When|Start|Hares?|Beer\s*Meister|Cost|Shiggy\s*Level|Special\s*Instructions|On[\s-]*On):\s*$/i, "")
      .trim();
    // An all-emoji title (#2080, run #2013: "🌧️🍺~ 🌤️") can leave orphaned
    // combining marks — e.g. a lone U+FE0F variation selector — that survive
    // the emoji strip and trim() as a blank-but-truthy title. Rather than chase
    // every combiner codepoint, treat a title with no letter or digit as empty
    // → undefined, so merge.ts synthesizes "7H4 Trail #N" (never the hare name).
    const stripped = rawName
      .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "")
      .replace(/[~\-!]+/g, " ")
      .replaceAll(/\s+/g, " ")
      .trim();
    title = /[\p{L}\p{N}]/u.test(stripped) ? stripped : undefined;
  }

  return { runNumber, title, date, startTime, hares, location };
}

/**
 * 7H4 Google Sites HTML scraper. Emits at most one event per scrape (the
 * current/upcoming trail from the homepage).
 */
export class SevenHillsH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source): Promise<ScrapeResult> {
    const url = source.url || "https://sites.google.com/view/7h4/home";
    const errorDetails: ErrorDetails = {};
    const errors: string[] = [];

    const page = await fetchHTMLPage(url);
    if (!page.ok) return page.result;
    const { html, structureHash, fetchDurationMs } = page;

    const events: RawEventData[] = [];
    const parsed = parseSevenHillsPage(html);

    if (!parsed) {
      errors.push("No trail block found on the 7H4 Google Sites page");
      errorDetails.parse = [{
        row: 0,
        section: "homepage",
        error: "No TRAIL #N / date phrase on page",
        rawText: html.slice(0, 500),
      }];
    } else {
      events.push({
        date: parsed.date,
        kennelTags: ["7h4"],
        runNumber: parsed.runNumber,
        title: parsed.title,
        hares: parsed.hares,
        location: parsed.location,
        startTime: parsed.startTime,
        sourceUrl: url,
      });
    }

    return {
      events,
      errors,
      structureHash,
      errorDetails: hasAnyErrors(errorDetails) ? errorDetails : undefined,
      diagnosticContext: {
        url,
        eventsParsed: events.length,
        fetchDurationMs,
      },
    };
  }
}
