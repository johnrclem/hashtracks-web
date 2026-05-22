import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";
import { chronoParseDate, normalizeHaresField, stripPlaceholder } from "../utils";
import { runSportyAdapter } from "./sporty-co-nz";

/**
 * Capital Hash House Harriers (Wellington, NZ) — sporty.co.nz CMS scraper.
 *
 * Source: https://www.sporty.co.nz/capitalh3 — homepage embeds the
 * "Receding Hareline" inside a CMS `notices` panel
 * (`<div id="notices-prevContent-<moduleId>">`). Each upcoming run is a
 * `<p>` element whose text content takes the form:
 *
 *   "{RUN#} – {DD MMM YYYY} – {LOCATION} – {HARE}"
 *
 * Some rows omit the LOCATION ("Hare required!") and some omit the HARE.
 * Trailing dashes on incomplete rows are tolerated.
 *
 * sporty.co.nz is behind Cloudflare Bot Fight Mode, so the actual fetch
 * runs through the stealth NAS browser-render service (see
 * {@link runSportyAdapter}).
 */

const CAPITAL_RUN_LINE_RE = /^(\d+)\s*-\s*(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})\s*(?:-\s*(.*))?$/; // NOSONAR S5852

/** Parse one notices-panel `<p>` line into a RawEventData, or null if the
 *  line doesn't look like a run row. Exported for unit testing. */
export function parseCapitalRunLine(
  line: string,
  opts: { sourceUrl: string; kennelTag: string },
): RawEventData | null {
  const normalised = line.replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
  if (!normalised) return null;

  const m = CAPITAL_RUN_LINE_RE.exec(normalised);
  if (!m) return null;
  const [, runStr, dateStr, restRaw] = m;

  const date = chronoParseDate(dateStr, "en-GB");
  if (!date) return null;
  const runNumber = Number.parseInt(runStr, 10);

  // Trailing dashes on placeholder rows leave empty trailing tokens; filter.
  const parts = (restRaw ?? "")
    .split(" - ")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  // Known placeholders ("Hare required!" / "TBA" / "?") become explicit
  // `null` so the merge pipeline scrubs stale `locationName` / `haresText`
  // from earlier scrapes (#1521/#1523 cycle-9 escape). `undefined` is
  // reserved for "source provided nothing" (segment missing), which keeps
  // the atomic-bundle "preserve existing" semantics.
  return {
    date,
    kennelTags: [opts.kennelTag],
    runNumber: Number.isFinite(runNumber) ? runNumber : undefined,
    location: clearOrValue(parts[0], stripPlaceholder),
    hares: clearOrValue(parts[1], (s) => normalizeHaresField(stripPlaceholder(s))),
    sourceUrl: opts.sourceUrl,
  };
}

/**
 * Tri-state segment normalizer:
 *   - segment missing (`undefined`)         → `undefined` (preserve existing)
 *   - segment present + transform returns ""/null → `null` (explicit clear)
 *   - segment present + real value          → trimmed text
 *
 * Used to flag placeholder cells ("Hare required!" / "TBA" / "?") so the merge
 * pipeline scrubs stale `locationName` / `haresText` from earlier scrapes
 * (#1521/#1523 cycle-9 escape).
 */
function clearOrValue(
  segment: string | undefined,
  transform: (s: string) => string | null | undefined,
): string | null | undefined {
  if (segment === undefined) return undefined;
  return transform(segment) ?? null;
}

export class CapitalH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    return runSportyAdapter(source, options, {
      defaultKennelTag: "capital-h3-nz",
      contentSelector: ".panel-body-text",
      section: "hareline",
      collect: ($) => {
        // Sporty's CMS notices module uses an opaque numeric id per kennel;
        // match on the prefix so we don't have to encode the id in config.
        const panel = $('[id^="notices-prevContent-"]');
        const rows = panel
          .find("p")
          .toArray()
          .map((el) => $(el).text())
          .filter((text) => text && /\d/.test(text));
        return {
          rows,
          missingContainer:
            panel.length === 0
              ? "Capital H3: notices-prevContent-* panel not found on page"
              : null,
        };
      },
      parse: parseCapitalRunLine,
    });
  }
}
