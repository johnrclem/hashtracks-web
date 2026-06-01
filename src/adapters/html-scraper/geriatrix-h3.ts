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
  cleanLocationName,
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

// Accept "Hare:" AND "Hares:" — sporty editors swap labels depending on
// trail-setter count. The captured label is passed back to valueAfterLabel
// so the slice lands at the right offset.
const GERIATRIX_LABEL_RE = /^\s*(venue|hares?|map)\b/i;

/** Apply one non-date paragraph to the in-progress row by matching its
 *  label prefix. Extracted from {@link parseGeriatrixParagraphs} to keep
 *  that function under Sonar S3776's cognitive-complexity threshold. */
function applyGeriatrixLabel(
  row: ParsedGeriatrixRow,
  p: { text: string; firstHref?: string },
): void {
  const labelMatch = GERIATRIX_LABEL_RE.exec(p.text);
  if (!labelMatch) return;
  const label = labelMatch[1].toLowerCase();
  if (label === "venue") {
    row.venue = valueAfterLabel(p.text, "Venue");
  } else if (label === "map") {
    // Prefer the <a href> over visible text — Geriatrix duplicates the
    // URL into the visible text but it may be visually truncated.
    row.mapUrl = p.firstHref ?? valueAfterLabel(p.text, "Map");
  } else {
    row.hare = valueAfterLabel(p.text, labelMatch[1]);
  }
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
    } else if (current) {
      applyGeriatrixLabel(current, p);
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
        const text = $(el).text().replaceAll("\u00a0", " ").replace(/\s+/g, " ").trim();
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
          // Run the venue through the shared cleaner — strips appended source
          // qualifiers like " - Maybe" / " - Memorial Run" (#1880) plus emoji/
          // URL noise. Preserve the merge tri-state: `undefined` when there was
          // no Venue field (placeholder already normalised away), otherwise the
          // cleaner's value or `null` (explicit clear) for non-venue text.
          const location =
            row.venue !== undefined ? cleanLocationName(row.venue) : undefined;
          events.push({
            date: row.date,
            kennelTags: [kennelTag],
            location,
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
