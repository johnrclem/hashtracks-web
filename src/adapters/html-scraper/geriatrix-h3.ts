import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import {
  buildDateWindow,
  chronoParseDate,
  configString,
  fetchBrowserRenderedPage,
  normalizeHaresField,
  stripPlaceholder,
} from "../utils";

/**
 * Port Nicholson Geriatrix H3 (Wellington, NZ) — sporty.co.nz hareline scraper.
 *
 * Source: https://www.sporty.co.nz/geriatrixhhh/Receding-Hareline/NewTab1
 * Layout: CKEditor `<div class="richtext-editor">` with consecutive `<p>`
 * elements arranged in 4-line blocks:
 *
 *   <p>DD/MM/YYYY</p>
 *   <p>Venue: …</p>
 *   <p>Hare: …</p>
 *   <p>Map: <a href="…">…</a></p>
 *   <p><br></p>   ← separator
 *
 * Some rows have `Venue: TBA` / `Hare: Hare Required` / blank `Map:` —
 * placeholders are normalised to `undefined` so the merge pipeline's
 * atomic-bundle semantics preserve any previously stored value.
 *
 * sporty.co.nz is behind Cloudflare Bot Fight Mode → route through the
 * stealth NAS browser-render service.
 */

const SPORTY_READY_SELECTOR = ".cms-nav-link, .richtext-editor";
const DDMMYYYY_RE = /^\d{1,2}\/\d{1,2}\/\d{4}$/;

/** Pull the value out of a "Label: value" paragraph; returns undefined if
 *  the label is missing OR the value is a placeholder/empty. Sporty's editors
 *  often type "Hare: Hare Required" / "Venue: Venue TBA" — strip a redundant
 *  label-word prefix before placeholder-checking so the trailing token gets
 *  classified correctly. */
function valueAfterLabel(paragraphText: string, label: string): string | undefined {
  const lowerText = paragraphText.toLowerCase();
  const lowerLabel = label.toLowerCase();
  const idx = lowerText.indexOf(lowerLabel);
  if (idx === -1) return undefined;
  const afterLabel = paragraphText.slice(idx + label.length).replace(/^[:\s]+/, "");
  const hasRedundantPrefix = afterLabel.toLowerCase().startsWith(`${lowerLabel} `);
  const tail = hasRedundantPrefix ? afterLabel.slice(label.length + 1).trimStart() : afterLabel;
  return stripPlaceholder(tail);
}

export interface ParsedGeriatrixRow {
  date: string;
  venue?: string;
  hare?: string;
  mapUrl?: string;
}

/** Walk the ordered `<p>` list and group consecutive runs into 4-line
 *  blocks anchored by a DD/MM/YYYY paragraph. Exported for unit tests. */
export function parseGeriatrixParagraphs(
  paragraphs: { text: string; firstHref?: string }[],
): ParsedGeriatrixRow[] {
  const out: ParsedGeriatrixRow[] = [];
  let current: ParsedGeriatrixRow | null = null;

  for (const p of paragraphs) {
    const trimmed = p.text.trim();
    const dateIso = DDMMYYYY_RE.test(trimmed) ? chronoParseDate(trimmed, "en-GB") : null;
    if (dateIso) {
      if (current) out.push(current);
      current = { date: dateIso };
      continue;
    }
    if (!current) continue;
    if (/^\s*venue\b/i.test(p.text)) {
      current.venue = valueAfterLabel(p.text, "Venue");
    } else if (/^\s*hare\b/i.test(p.text)) {
      current.hare = valueAfterLabel(p.text, "Hare");
    } else if (/^\s*map\b/i.test(p.text)) {
      // Prefer the <a href> over the visible text — visible text on Geriatrix
      // duplicates the URL but may be visually truncated.
      current.mapUrl = p.firstHref ?? valueAfterLabel(p.text, "Map");
    }
  }
  if (current) out.push(current);
  return out;
}

export class GeriatrixH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const sourceUrl = source.url;
    const kennelTag = configString(source.config, "kennelTag", "geriatrix-h3");

    const page = await fetchBrowserRenderedPage(sourceUrl, {
      waitFor: SPORTY_READY_SELECTOR,
      timeout: 25_000,
      timezoneId: "Pacific/Auckland",
    });
    if (!page.ok) return page.result;
    const { $, structureHash, fetchDurationMs } = page;

    // Walk the richtext-editor's ordered <p> list. Empty/<br>-only
    // paragraphs become {text: ""} and are ignored by parseGeriatrixParagraphs.
    const paragraphs: { text: string; firstHref?: string }[] = [];
    const $editor = $(".richtext-editor").first();
    const editorFound = $editor.length > 0;
    if (editorFound) {
      $editor.find("p").each((_i, el) => {
        const text = $(el).text().replace(/ /g, " ").replace(/\s+/g, " ").trim();
        const firstHref = $(el).find("a").first().attr("href");
        paragraphs.push({ text, firstHref });
      });
    }

    const rows = parseGeriatrixParagraphs(paragraphs);

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    const parseErrors: NonNullable<ErrorDetails["parse"]> = [];
    const { minDate, maxDate } = buildDateWindow(options?.days ?? 180);

    // Fail closed: if the CKEditor block is absent (CF challenge HTML slipped
    // past readiness, sporty reorganised the layout, or render returned a
    // degraded page), surface as an error so reconciliation doesn't treat
    // the empty result as authoritative and cancel live events.
    if (!editorFound) {
      errors.push("Geriatrix H3: .richtext-editor container not found on page");
    }

    let i = 0;
    for (const row of rows) {
      try {
        const eventDate = new Date(`${row.date}T12:00:00Z`);
        if (eventDate >= minDate && eventDate <= maxDate) {
          events.push({
            date: row.date,
            kennelTags: [kennelTag],
            location: row.venue,
            locationUrl: row.mapUrl,
            hares: normalizeHaresField(row.hare),
            sourceUrl,
          });
        }
      } catch (err) {
        errors.push(`Row ${i}: ${err}`);
        parseErrors.push({
          row: i,
          section: "hareline",
          error: String(err),
          rawText: JSON.stringify(row).slice(0, 500),
        });
      }
      i += 1;
    }

    if (parseErrors.length > 0) errorDetails.parse = parseErrors;

    return {
      events,
      errors,
      structureHash,
      errorDetails: hasAnyErrors(errorDetails) ? errorDetails : undefined,
      diagnosticContext: {
        paragraphsScanned: paragraphs.length,
        runBlocksFound: rows.length,
        eventsParsed: events.length,
        fetchDurationMs,
        editorFound,
      },
    };
  }
}
