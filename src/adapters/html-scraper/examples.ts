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

// ─── Factory helpers (reduce structural repetition) ─────────────────────────

function tableExample(
  name: string,
  opts: { rowSelector?: string; dateLocale?: "en-US" | "en-GB"; columns: Record<string, string>; notes: string },
): AdapterExample {
  return {
    name,
    layoutType: "table",
    containerSelector: "table",
    rowSelector: opts.rowSelector ?? "tbody tr",
    columns: opts.columns,
    dateLocale: opts.dateLocale ?? "en-US",
    notes: opts.notes,
  };
}

function divExample(
  name: string,
  opts: { rowSelector: string; columns: Record<string, string>; notes: string },
): AdapterExample {
  return {
    name,
    layoutType: "div-cards",
    containerSelector: "body",
    rowSelector: opts.rowSelector,
    columns: opts.columns,
    dateLocale: "en-GB",
    notes: opts.notes,
  };
}

function articleExample(
  name: string,
  opts: { columns: Record<string, string>; notes: string },
): AdapterExample {
  return {
    name,
    layoutType: "article",
    containerSelector: "body",
    rowSelector: "article",
    columns: opts.columns,
    dateLocale: "en-US",
    notes: opts.notes,
  };
}

/**
 * Patterns from existing named adapters, organized by layout type.
 * These serve as few-shot context for the Gemini analysis prompt.
 */
export const ADAPTER_EXAMPLES: AdapterExample[] = [
  // ─── TABLE layouts ───────────────────────────────────────────────────
  tableExample("SFH3 MultiHash", {
    columns: { runNumber: "td:nth-child(1)", date: "td:nth-child(2)", hares: "td:nth-child(3)", location: "td:nth-child(4)", kennelTag: "td:nth-child(5)" },
    notes: "5-column table with date as M/D/YYYY, location may contain Google Maps link",
  }),
  tableExample("BarnesH3", {
    rowSelector: "tr",
    dateLocale: "en-GB",
    columns: { runNumber: "td:nth-child(1)", date: "td:nth-child(2)", hares: "td:nth-child(3)", location: "td:nth-child(4)" },
    notes: "UK hash run list with ordinal dates (19th February 2026), UK postcodes in location",
  }),
  tableExample("OCH3", {
    rowSelector: "tr",
    dateLocale: "en-GB",
    columns: { date: "td:nth-child(1)", hares: "td:nth-child(2)", location: "td:nth-child(3)" },
    notes: "UK ordinal dates, hares as 'Hare: Name', location may include pub name and postcode",
  }),

  // ─── DIV-card layouts ────────────────────────────────────────────────
  divExample("CityHash", {
    rowSelector: ".ch-run",
    columns: { date: ".ch-run-title h5", hares: ".ch-run-description p", location: ".ch-run-location a" },
    notes: "Repeating div cards with class-based selectors, date embedded in title text",
  }),
  divExample("WestLondonHash", {
    rowSelector: ".run-entry, .event-item",
    columns: { date: ".run-date", hares: ".run-hares", location: ".run-location", runNumber: ".run-number" },
    notes: "UK hash with structured div entries, dates with ordinal suffixes",
  }),

  // ─── WordPress article layouts ───────────────────────────────────────
  articleExample("ChicagoHash", {
    columns: { date: "time[datetime]", title: ".entry-title" },
    notes: "WordPress blog posts, uses <time datetime> attribute, hares/location in body text as 'Hares: ...' labels",
  }),
  articleExample("EWH3", {
    columns: { date: "time[datetime]", title: ".entry-title a" },
    notes: "WordPress trail news, label-based field extraction from post body",
  }),
];

/**
 * Get examples matching a specific layout type, for targeted few-shot prompting.
 * Falls back to the first 3 examples if the layout type has fewer than 2 matches.
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
