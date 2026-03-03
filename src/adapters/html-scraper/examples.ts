/**
 * Static catalog of existing HTML adapter patterns.
 *
 * Distilled from our 15+ named adapters into GenericHtmlConfig-equivalent
 * descriptions. Used as few-shot examples in the Gemini AI prompt so the
 * system can recognize common hash site layouts from day 1.
 */

/** A working adapter pattern distilled for use as a Gemini few-shot example. */
export interface AdapterExample {
  name: string;
  layoutType: "table" | "div-cards" | "article" | "text-block";
  containerSelector: string;
  rowSelector: string;
  columns: Record<string, string>;
  dateLocale: "en-US" | "en-GB";
  notes: string;
}

/**
 * Patterns from existing named adapters, organized by layout type.
 * These serve as few-shot context for the Gemini analysis prompt.
 */
export const ADAPTER_EXAMPLES: AdapterExample[] = [
  // ─── TABLE layouts ───────────────────────────────────────────────────
  {
    name: "SFH3 MultiHash",
    layoutType: "table",
    containerSelector: "table",
    rowSelector: "tbody tr",
    columns: {
      runNumber: "td:nth-child(1)",
      date: "td:nth-child(2)",
      hares: "td:nth-child(3)",
      location: "td:nth-child(4)",
      kennelTag: "td:nth-child(5)",
    },
    dateLocale: "en-US",
    notes: "5-column table with date as M/D/YYYY, location may contain Google Maps link",
  },
  {
    name: "BarnesH3",
    layoutType: "table",
    containerSelector: "table",
    rowSelector: "tr",
    columns: {
      runNumber: "td:nth-child(1)",
      date: "td:nth-child(2)",
      hares: "td:nth-child(3)",
      location: "td:nth-child(4)",
    },
    dateLocale: "en-GB",
    notes: "UK hash run list with ordinal dates (19th February 2026), UK postcodes in location",
  },
  {
    name: "OCH3",
    layoutType: "table",
    containerSelector: "table",
    rowSelector: "tr",
    columns: {
      date: "td:nth-child(1)",
      hares: "td:nth-child(2)",
      location: "td:nth-child(3)",
    },
    dateLocale: "en-GB",
    notes: "UK ordinal dates, hares as 'Hare: Name', location may include pub name and postcode",
  },

  // ─── DIV-card layouts ────────────────────────────────────────────────
  {
    name: "CityHash",
    layoutType: "div-cards",
    containerSelector: "body",
    rowSelector: ".ch-run",
    columns: {
      date: ".ch-run-title h5",
      hares: ".ch-run-description p",
      location: ".ch-run-location a",
    },
    dateLocale: "en-GB",
    notes: "Repeating div cards with class-based selectors, date embedded in title text",
  },
  {
    name: "WestLondonHash",
    layoutType: "div-cards",
    containerSelector: "body",
    rowSelector: ".run-entry, .event-item",
    columns: {
      date: ".run-date",
      hares: ".run-hares",
      location: ".run-location",
      runNumber: ".run-number",
    },
    dateLocale: "en-GB",
    notes: "UK hash with structured div entries, dates with ordinal suffixes",
  },

  // ─── WordPress article layouts ───────────────────────────────────────
  {
    name: "ChicagoHash",
    layoutType: "article",
    containerSelector: "body",
    rowSelector: "article",
    columns: {
      date: "time[datetime]",
      title: ".entry-title",
    },
    dateLocale: "en-US",
    notes: "WordPress blog posts, uses <time datetime> attribute, hares/location in body text as 'Hares: ...' labels",
  },
  {
    name: "EWH3",
    layoutType: "article",
    containerSelector: "body",
    rowSelector: "article",
    columns: {
      date: "time[datetime]",
      title: ".entry-title a",
    },
    dateLocale: "en-US",
    notes: "WordPress trail news, label-based field extraction from post body",
  },
];

/**
 * Get examples matching a specific layout type, for targeted few-shot prompting.
 * Falls back to all examples if the layout type has fewer than 2 matches.
 */
export function getExamplesForLayout(layoutType: string): AdapterExample[] {
  const matched = ADAPTER_EXAMPLES.filter((e) => e.layoutType === layoutType);
  return matched.length >= 2 ? matched : ADAPTER_EXAMPLES.slice(0, 3);
}

/**
 * Format adapter examples as text for inclusion in a Gemini prompt.
 */
export function formatExamplesForPrompt(examples: AdapterExample[]): string {
  return examples
    .map((ex, i) => {
      const cols = Object.entries(ex.columns)
        .map(([field, selector]) => `    ${field}: "${selector}"`)
        .join("\n");
      return [
        `Example ${i + 1} (${ex.name} — ${ex.layoutType}):`,
        `  Container: "${ex.containerSelector}" → Row: "${ex.rowSelector}"`,
        `  Date locale: ${ex.dateLocale}`,
        `  Columns:`,
        cols,
        `  Notes: ${ex.notes}`,
      ].join("\n");
    })
    .join("\n\n");
}
