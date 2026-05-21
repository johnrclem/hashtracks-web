import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";
import { chronoParseDate, parse12HourTime } from "../utils";
import { runSportyAdapter } from "./sporty-co-nz";

/**
 * Mooloo Hash House Harriers (Hamilton, NZ) — sporty.co.nz newsletter parser.
 *
 * Source: https://www.sporty.co.nz/mooloohhh/UpCumming-Runs
 * The page is more newsletter than structured hareline: long prose
 * paragraphs mixed with one or two explicit run lines like:
 *
 *   "25 May 2026 RUN# 1886 Tittannic's Trail from ReefUnder and Shunter's 8 Joffre St. 6PM."
 *
 * We extract every `<p>` line that matches that prefix pattern (date +
 * "RUN# NNNN" + free-form body). Run number and date drive Event identity;
 * a 12-hour time mention drives `startTime`. The body also gets two
 * conservative tokenizers applied (#1505):
 *   - hare = the name preceding "'s Trail" (so "Tittannic's Trail from
 *     ReefUnder and Shunter's" yields hare=Tittannic, not the hosts)
 *   - locationStreet = a numeric street address like "8 Joffre St"
 * The full body still goes into `description` so hosts and any free-form
 * context the source author included aren't lost.
 *
 * Cloudflare bypass + boilerplate is delegated to {@link runSportyAdapter}.
 */

// "DD Mon YYYY RUN# NNNN <body>". Tolerant of unicode dashes and
// "RUN#NNNN" / "RUN # NNNN" spacing. Trailing period stripped post-match.
const MOOLOO_RUN_LINE_RE = /^(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})\s+RUN\s*#?\s*(\d+)\s+(.+?)\.?\s*$/; // NOSONAR S5852

// Hare = the name preceding "'s Trail" in the free-form body. The source
// authors consistently use the possessive-Trail idiom for the trail-setter
// ("Tittannic's Trail from ReefUnder and Shunter's 8 Joffre St.") and
// "from <Hosts>" / "at <Hosts>'s" for the people whose place the trail
// starts from. We deliberately only extract the "<Name>'s Trail" form so
// hosts aren't mislabelled as hares; the full body remains in description.
//
// `[\w \-]` accepts multi-word hash names ("Mr Ed", "No More", "Dog-Food")
// without admitting apostrophes (which would race the trailing `'s`).
// Bounded to 40 chars to keep this backtrack-safe under Sonar S5852.
const MOOLOO_HARE_RE = /^([A-Za-z][\w \-]{0,40})'s\s+Trail\b/i;

// Street address shape: 1–4 digit street number + 1–4 capitalised words +
// a NZ/AU/UK street-type suffix. Bounded quantifiers + leading word
// boundary keep this Sonar S5852-safe and prevent grabbing run numbers
// or distances mid-sentence.
const MOOLOO_ADDRESS_RE = /\b(\d{1,4}(?:\s+[A-Z][\w']+){1,4}\s+(?:St|Rd|Ave|Cres|Way|Dr|Pl|Cl|Ln|Cct|Blvd|Tce|Crt|Ct|Pde|Lane|Street|Road|Avenue|Drive|Place|Close))\.?(?=$|[\s,])/;

/** Pull a 12-hour time out of free-form text, normalizing bare-hour forms
 *  like "6PM" / "6 pm" (which parse12HourTime requires minutes for) into
 *  "6:00 PM" first. */
function extractStartTime(text: string): string | undefined {
  const match = /(?<!\w)(\d{1,2}(?::\d{2})?\s*[ap]m)/i.exec(text);
  if (!match) return undefined;
  const raw = match[1].trim();
  const normalized = raw.includes(":") ? raw : raw.replace(/(\d{1,2})\s*([ap]m)/i, "$1:00 $2");
  return parse12HourTime(normalized);
}

function extractHares(body: string): string | undefined {
  const m = MOOLOO_HARE_RE.exec(body);
  return m ? m[1] : undefined;
}

function extractStreetAddress(body: string): string | undefined {
  const m = MOOLOO_ADDRESS_RE.exec(body);
  return m ? m[1] : undefined;
}

/** Parse one Mooloo run-line `<p>` text into a RawEventData, or null. Exported for unit tests. */
export function parseMoolooRunLine(
  text: string,
  opts: { sourceUrl: string; kennelTag: string },
): RawEventData | null {
  const normalised = text.replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
  if (!normalised) return null;

  const m = MOOLOO_RUN_LINE_RE.exec(normalised);
  if (!m) return null;
  const [, dateStr, runStr, body] = m;

  const date = chronoParseDate(dateStr, "en-GB");
  if (!date) return null;
  const runNumber = Number.parseInt(runStr, 10);

  return {
    date,
    kennelTags: [opts.kennelTag],
    runNumber: Number.isFinite(runNumber) ? runNumber : undefined,
    startTime: extractStartTime(body),
    hares: extractHares(body),
    locationStreet: extractStreetAddress(body),
    description: body,
    sourceUrl: opts.sourceUrl,
  };
}

export class MoolooHhhAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    return runSportyAdapter(source, options, {
      defaultKennelTag: "mooloo-h3",
      contentSelector: ".panel-body-text",
      section: "newsletter",
      collect: ($) => {
        // Every `<p>` is a candidate; parseMoolooRunLine() filters newsletter
        // prose by requiring the "DD Mon YYYY RUN# NNNN ..." prefix.
        const container = $(".panel-body-text");
        const rows = container
          .find("p")
          .toArray()
          .map((el) => $(el).text())
          .filter((text) => text && /RUN/i.test(text));
        return {
          rows,
          missingContainer:
            container.length === 0
              ? "Mooloo HHH: .panel-body-text container not found on page"
              : null,
        };
      },
      parse: parseMoolooRunLine,
    });
  }
}
